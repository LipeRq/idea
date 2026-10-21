"use client";

import { useEffect, useMemo, useRef } from "react";
import { DIAGRAM_FAILED_IN_DOCUMENT } from "@/lib/document-export";
import { fillDiagrams, sanitizeDocumentHtml } from "@/lib/markdown-html";
import { renderDiagram } from "@/lib/mermaid-render";
import type { RenderedDocument } from "@/worker/protocol";
import { Notice } from "./ui";

/** 仕様書のプレビュー。印刷はこの表示を使う(タブで隠れていても印刷用 CSS で出す) */
export function DocumentView({ doc, purpose }: { doc: RenderedDocument; purpose: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => (doc.previewable ? sanitizeDocumentHtml(doc.html) : ""), [doc]);
  useEffect(() => {
    const el = ref.current;
    if (!el || !doc.previewable) return;
    el.innerHTML = html;
    let alive = true;
    void (async () => {
      const svgs: (string | null)[] = [];
      for (const code of doc.diagrams) {
        svgs.push(await renderDiagram(code, purpose));
        if (!alive) return;
      }
      fillDiagrams(el, svgs, doc.diagrams, DIAGRAM_FAILED_IN_DOCUMENT);
      el.dataset.diagramsReady = "true";
    })();
    return () => {
      alive = false;
    };
  }, [html, doc, purpose]);

  if (!doc.previewable) {
    return (
      <Notice level="info">
        仕様書が大きいため、画面でのプレビューを省略しました({(doc.markdownBytes / 1024 / 1024).toFixed(1)}MB)。「レポートを保存」で保存してから、ブラウザで開いてください。
      </Notice>
    );
  }
  return <div ref={ref} className="doc-body" />;
}
