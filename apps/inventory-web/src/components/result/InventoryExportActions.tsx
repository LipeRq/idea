"use client";

import { useEffect, useRef, useState } from "react";
import { downloadText, exportFileName, standaloneHtml } from "@/lib/export";
import type { FileGraph } from "@/lib/external-refs";
import { inventoryCsv, inventoryHtmlBody, inventoryMarkdown, type InventoryRow } from "@/lib/inventory-list";
import { renderDiagram } from "@/lib/mermaid-render";
import { buttonPrimary, buttonSecondary } from "../ui";

/** 棚卸し一覧の保存。HTML(ブラウザで開ける)と CSV(表計算ソフト用)、技術者向けに Markdown */
export function InventoryExportActions({ rows, graph }: { rows: InventoryRow[]; graph: FileGraph | null }) {
  // 単体の HTML(関係図の SVG 入り)は、一覧を表示した後に用意しておく(押してから図を描くと、保存が止められることがあるため)
  const [prepared, setPrepared] = useState<{ rows: InventoryRow[]; html: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const pendingRef = useRef(false);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const svg = graph ? await renderDiagram(graph.code, "export-list") : null;
          const html = standaloneHtml("棚卸し一覧", inventoryHtmlBody(rows, graph, svg));
          if (!alive) return;
          setPrepared({ rows, html });
          if (pendingRef.current) {
            pendingRef.current = false;
            setPending(false);
            downloadText(exportFileName("", "listHtml"), html, "text/html;charset=utf-8");
          }
        } catch {
          if (!alive) return;
          pendingRef.current = false;
          setPending(false);
          setFailed(true);
        }
      })();
    }, 0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [rows, graph]);
  const readyHtml = prepared?.rows === rows ? prepared.html : null;
  const saveHtml = () => {
    if (readyHtml) {
      downloadText(exportFileName("", "listHtml"), readyHtml, "text/html;charset=utf-8");
    } else {
      pendingRef.current = true;
      setPending(true);
    }
  };
  return (
    <div className="no-print">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonPrimary} onClick={saveHtml} disabled={pending || failed} data-ready={readyHtml ? "true" : "false"}>
          {pending ? "作成しています…" : "一覧を保存(HTML。ブラウザで開けます)"}
        </button>
        <button type="button" className={buttonSecondary} onClick={() => downloadText(exportFileName("", "listCsv"), inventoryCsv(rows), "text/csv;charset=utf-8")}>
          表計算ソフト用に保存(CSV)
        </button>
      </div>
      {failed && <p className="mt-2 text-sm text-critical-ink">HTML を作れませんでした。CSV か、技術者向けの形式(Markdown)で保存してください。</p>}
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-accent-ink">技術者向けの形式で保存</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonSecondary}
            onClick={() => downloadText(exportFileName("", "listMarkdown"), inventoryMarkdown(rows, graph), "text/markdown;charset=utf-8")}
          >
            一覧(Markdown)
          </button>
        </div>
        <p className="mt-2 text-xs text-ink-2">Markdown は GitHub や VS Code などで、ファイル間の関係図(Mermaid)も表示できます。</p>
      </details>
    </div>
  );
}
