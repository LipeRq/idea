// 仕様書の単体 HTML を作る(画面で DOMPurify を通した HTML に、図の SVG を差し込む)。
import type { RenderedDocument } from "@/worker/protocol";
import { standaloneHtml } from "./export";
import { fillDiagrams, sanitizeDocumentHtml } from "./markdown-html";
import { renderDiagram } from "./mermaid-render";

export const DIAGRAM_FAILED_IN_DOCUMENT = "図を表示できませんでした。図のコードを示します(Mermaid に対応したエディタで図として表示できます)。";

export async function buildStandaloneHtml(doc: RenderedDocument, title: string): Promise<string> {
  const container = document.createElement("div");
  container.innerHTML = sanitizeDocumentHtml(doc.html);
  const svgs: (string | null)[] = [];
  for (const code of doc.diagrams) svgs.push(await renderDiagram(code, "export"));
  fillDiagrams(container, svgs, doc.diagrams, DIAGRAM_FAILED_IN_DOCUMENT);
  return standaloneHtml(title, container.innerHTML);
}
