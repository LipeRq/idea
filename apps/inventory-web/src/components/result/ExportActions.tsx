"use client";

import { useEffect, useRef, useState } from "react";
import { buildStandaloneHtml } from "@/lib/document-export";
import { downloadText, exportFileName, type ExportKind } from "@/lib/export";
import type { RenderedDocument } from "@/worker/protocol";
import { buttonPrimary, buttonSecondary } from "../ui";

/** 保存・印刷のボタン。主なボタンは HTML(ブラウザで開ける)と印刷。Markdown・JSON は技術者向けに畳む */
export function ExportActions({
  fileName,
  doc,
  json,
  variant,
}: {
  fileName: string;
  doc: RenderedDocument;
  /** 抽出結果(JSON)。AI 版では無し */
  json?: () => string;
  variant: "standard" | "ai";
}) {
  const ai = variant === "ai";
  const save = (kind: ExportKind, text: string, type: string) => downloadText(exportFileName(fileName, kind), text, type);
  const htmlKind: ExportKind = ai ? "aiHtml" : "html";
  const title = `${ai ? "仕様書(AI版)" : "棚卸しレポート"}: ${fileName}`;

  // 単体の HTML(図の SVG 入り)は、結果を表示した後に用意しておく。
  // 押してから図を描くと時間がかかり、ブラウザが「ボタンを押して始まった保存」と見なさずに止めることがあるため
  const [prepared, setPrepared] = useState<{ doc: RenderedDocument; html: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const pendingRef = useRef(false);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      buildStandaloneHtml(doc, title).then(
        (html) => {
          if (!alive) return;
          setPrepared({ doc, html });
          if (pendingRef.current) {
            pendingRef.current = false;
            setPending(false);
            downloadText(exportFileName(fileName, htmlKind), html, "text/html;charset=utf-8");
          }
        },
        () => {
          if (!alive) return;
          pendingRef.current = false;
          setPending(false);
          setFailed(true);
        },
      );
    }, 0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [doc, title, fileName, htmlKind]);
  const readyHtml = prepared?.doc === doc ? prepared.html : null;
  const saveHtml = () => {
    if (readyHtml) {
      save(htmlKind, readyHtml, "text/html;charset=utf-8");
    } else {
      pendingRef.current = true;
      setPending(true);
    }
  };
  return (
    <div className="no-print">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonPrimary} onClick={saveHtml} disabled={pending || failed} data-ready={readyHtml ? "true" : "false"}>
          {pending ? "作成しています…" : ai ? "AI版のレポートを保存(HTML)" : "レポートを保存(HTML。ブラウザで開けます)"}
        </button>
        <button type="button" className={buttonSecondary} onClick={() => window.print()}>
          {ai ? "AI版を印刷・PDF" : "印刷・PDF"}
        </button>
      </div>
      {failed && <p className="mt-2 text-sm text-critical-ink">HTML を作れませんでした。「印刷・PDF」か、技術者向けの形式(Markdown)で保存してください。</p>}
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-accent-ink">技術者向けの形式で保存</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className={buttonSecondary} onClick={() => save(ai ? "aiMarkdown" : "markdown", doc.markdown, "text/markdown;charset=utf-8")}>
            {ai ? "AI版の仕様書(Markdown)" : "仕様書(Markdown)"}
          </button>
          {json && (
            <button type="button" className={buttonSecondary} onClick={() => save("json", json(), "application/json;charset=utf-8")}>
              抽出結果(JSON)
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-ink-2">
          Markdown は GitHub や VS Code などで図(Mermaid)も表示できます。
          {json && "抽出結果(JSON)には、マクロのソースコードと文書の作成者名が含まれます。取り扱いにご注意ください。"}
        </p>
      </details>
    </div>
  );
}
