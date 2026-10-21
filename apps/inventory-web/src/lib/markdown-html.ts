// Worker が markdown-it で作った HTML を、画面に入れる前に DOMPurify の許可リストに通す。
// 許可するのは仕様書で使うタグだけ(リンク・画像・スクリプト・イベント属性・style 属性は通さない)。
import DOMPurify from "dompurify";

export const DOCUMENT_ALLOWED_TAGS = [
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "hr", "ul", "ol", "li", "blockquote", "pre", "code",
  "table", "thead", "tbody", "tr", "th", "td", "strong", "em", "del", "s", "div", "details", "summary",
];
export const DOCUMENT_ALLOWED_ATTR = ["class", "data-mermaid-index", "start"];

export function sanitizeDocumentHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: DOCUMENT_ALLOWED_TAGS,
    ALLOWED_ATTR: DOCUMENT_ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
}

/** mermaid が作った SVG(securityLevel: strict)を、念のため SVG の許可リストにも通す(<style> は図の見た目に必要) */
export function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ["style"],
    FORBID_TAGS: ["foreignObject", "script", "a", "image", "use"],
    FORBID_ATTR: ["href", "xlink:href"],
  });
}

/** プレースホルダー(<div class="mermaid-src" data-mermaid-index="i">)に図を差し込む */
export function fillDiagrams(root: ParentNode, svgs: (string | null)[], codes: string[], failedNote: string): void {
  for (const el of root.querySelectorAll<HTMLElement>("div.mermaid-src[data-mermaid-index]")) {
    const index = Number(el.dataset.mermaidIndex);
    const svg = svgs[index];
    if (svg) {
      el.innerHTML = svg;
    } else {
      el.textContent = "";
      const note = document.createElement("p");
      note.textContent = failedNote;
      const pre = document.createElement("pre");
      pre.textContent = codes[index] ?? "";
      el.append(note, pre);
    }
  }
}
