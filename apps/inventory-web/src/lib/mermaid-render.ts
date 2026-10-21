// Mermaid の図を SVG にする(メインスレッド。DOM が必要なため Worker では描けない)。
// - npm の mermaid を自前で配信し(CDN は使わない)、securityLevel: strict、htmlLabels: false で描く
// - 図は常にライトテーマで描き、白い枠に入れる(画面がダークでも同じ見た目。印刷・HTML 保存と同じ SVG を使える)
// - mermaid 12 は図の種類ごとの実装を初めて描くときに別のチャンクを読み込むので、アイドル時に小さな flowchart を
//   1回描いておく(warmUpMermaid)。これで、ページを開いた後にネットワークを切っても図を描ける
// - render は同時に呼ぶと壊れることがあるため、1つずつ順番に描く
import type { Mermaid } from "mermaid";
import { sanitizeSvg } from "./markdown-html";

export const FONT_FAMILY =
  'system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic UI", Meiryo, sans-serif';

/** mermaid の既定(maxEdges 500)。超えると描けないので、コードの表示に切り替える */
export const MAX_EDGES = 500;
export const MAX_TEXT_SIZE = 100_000;

let loader: Promise<Mermaid> | null = null;

export function loadMermaid(): Promise<Mermaid> {
  if (!loader) {
    const loading = import("mermaid").then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        htmlLabels: false,
        deterministicIds: true,
        suppressErrorRendering: true,
        maxTextSize: MAX_TEXT_SIZE,
        maxEdges: MAX_EDGES,
        theme: "default",
        fontFamily: FONT_FAMILY,
        flowchart: { useMaxWidth: false, htmlLabels: false },
      });
      return mermaid;
    });
    loading.catch(() => {
      if (loader === loading) loader = null;
    });
    loader = loading;
  }
  return loader;
}

let queue: Promise<unknown> = Promise.resolve();
let counter = 0;

/**
 * 図のコードを SVG にする。描けない(読み込み失敗・構文エラー・大きすぎ)ときは null。
 * id には用途(purpose)を含め、同じ画面に同じ図を2回描いても SVG の id(<style> の範囲)がぶつからないようにする。
 */
export function renderDiagram(code: string, purpose: string): Promise<string | null> {
  const task = queue.then(async () => {
    try {
      const mermaid = await loadMermaid();
      const id = `mmd-${purpose.replace(/[^a-z0-9-]/gi, "")}-${++counter}`;
      const { svg } = await mermaid.render(id, code);
      return sanitizeSvg(svg);
    } catch {
      // 描画の途中で作られた一時的な要素が残ることがあるので消す
      document.querySelectorAll('[id^="dmmd-"]').forEach((el) => el.remove());
      return null;
    }
  });
  queue = task.catch(() => undefined);
  return task;
}

/** アイドル時に小さな flowchart を描き、図の描画に必要なコードをすべて読み込んでおく */
export async function warmUpMermaid(): Promise<boolean> {
  const svg = await renderDiagram("flowchart LR\n  a[\"準備\"] --> b[\"完了\"]", "warmup");
  return svg !== null;
}
