// 仕様書の Markdown を HTML にする(Worker の中で行い、画面を固めない)。
// - エンジンは表のセル内の改行に <br>、Access の SQL の開閉に <details><summary> を使うため html: true にする。
//   ファイル由来の文字列と AI の文章はエンジンがエスケープ済み(<img onerror> などは文字として出る)。
// - リンク・画像・自動リンクの記法は無効にする(仕様書の中から外部を指すリンクや画像を作らない)。
// - ```mermaid のフェンスはプレースホルダーに置き換え、図のコードは別の配列で返す(画面で SVG にする)。
// - 出力は画面で DOMPurify の許可リストに通してから表示する(src/lib/markdown-html.ts)。
import MarkdownIt from "markdown-it";

/** プレビューする Markdown の上限。超えたら HTML を作らず「保存して開いてください」と案内する */
export const PREVIEW_MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;

export interface MarkdownHtml {
  html: string;
  diagrams: string[];
}

type Renderer = InstanceType<typeof MarkdownIt>;

function createRenderer(): Renderer {
  const md = new MarkdownIt({ html: true, linkify: false, typographer: false });
  md.disable(["link", "image", "autolink", "linkify", "reference"]);
  md.core.ruler.disable(["linkify"]);
  const defaultFence = md.renderer.rules.fence!;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const diagrams = (env as { diagrams?: string[] } | undefined)?.diagrams;
    if (token.info.trim() === "mermaid" && diagrams) {
      const index = diagrams.push(token.content.replace(/\n$/, "")) - 1;
      return `<div class="mermaid-src" data-mermaid-index="${index}"></div>\n`;
    }
    return defaultFence(tokens, idx, options, env, self);
  };
  return md;
}

let renderer: Renderer | null = null;

export function markdownToHtml(markdown: string): MarkdownHtml {
  renderer ??= createRenderer();
  const env = { diagrams: [] as string[] };
  const html = renderer.render(markdown, env);
  return { html, diagrams: env.diagrams };
}
