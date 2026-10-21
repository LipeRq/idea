// 保存するファイルの名前と、単体の HTML(スクリプトなし・外部に何も読みに行かない)。
// ダウンロードは Blob + URL.createObjectURL + <a download>(送信ではない)。

/** ファイル名に使えない文字(\ / : * ? " < > |)と制御文字を _ にする。日本語はそのまま残す */
export function safeFileStem(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const cleaned = stem.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "_").trim();
  return cleaned.slice(0, 120) || "ファイル";
}

export type ExportKind = "html" | "markdown" | "json" | "aiHtml" | "aiMarkdown" | "aiPayload";

export function exportFileName(sourceName: string, kind: ExportKind): string {
  const stem = safeFileStem(sourceName);
  switch (kind) {
    case "html":
      return `${stem}_棚卸し.html`;
    case "markdown":
      return `${stem}_棚卸し.md`;
    case "json":
      return `${stem}_抽出結果.json`;
    case "aiHtml":
      return `${stem}_仕様書_AI.html`;
    case "aiMarkdown":
      return `${stem}_仕様書_AI.md`;
    case "aiPayload":
      return `${stem}_AI送信内容.json`;
  }
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** 単体 HTML のメタ CSP。スクリプト・外部の読み込みを一切許さない(図は SVG を埋め込むので img も data: だけ) */
export const STANDALONE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";

const STANDALONE_CSS = `
body{margin:0;background:#fff;color:#111;font-family:system-ui,-apple-system,"Segoe UI","Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic UI",Meiryo,sans-serif;line-height:1.7}
main{max-width:960px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:1.6rem;line-height:1.4}h2{font-size:1.3rem;margin-top:2em;border-bottom:1px solid #ddd;padding-bottom:.2em}h3{font-size:1.1rem;margin-top:1.6em}
table{border-collapse:collapse;display:block;overflow-x:auto;max-width:100%;margin:1em 0}th,td{border:1px solid #ccc;padding:4px 8px;vertical-align:top;font-size:.9rem}th{background:#f3f2ee;text-align:left}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.85em;background:#f3f2ee;padding:0 .2em;border-radius:3px;word-break:break-all}
pre{background:#f3f2ee;padding:12px;overflow-x:auto;border-radius:6px}pre code{background:none;padding:0}
blockquote{margin:1em 0;padding:.2em 1em;border-left:4px solid #ccc;color:#444}
.mermaid-src{margin:1em 0;padding:8px;border:1px solid #ddd;border-radius:6px;background:#fff;overflow-x:auto}.mermaid-src svg{max-width:100%;height:auto}
details{margin:.5em 0}summary{cursor:pointer}
@media print{main{max-width:none;padding:0}table{display:table}a{color:inherit}}
`;

/** 単体の HTML。bodyHtml は DOMPurify にかけた後のもの(図の SVG を差し込み済み) */
export function standaloneHtml(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${STANDALONE_CSP}">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<style>${STANDALONE_CSS}</style>
</head>
<body>
<main>
${bodyHtml}
</main>
</body>
</html>
`;
}

export function downloadText(fileName: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // ダウンロードが始まってから解放する
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
