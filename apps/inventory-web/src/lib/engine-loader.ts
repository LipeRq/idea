// 解析 Worker のスクリプトを取得して Blob URL にし、そこから Worker を起動する。
// 1回取得すればメモリ上の Blob から何度でも Worker を作れるので、ページを開いた後にネットワークを切っても
// (HTTP キャッシュの状態や、開発者ツールの「キャッシュを無効にする」に関係なく)解析を続けられる。
// Blob URL の Worker はページの CSP をそのまま引き継ぐ(connect-src 'self' などが Worker にも効く)。
// 通信を書ける場所を限定するため(ESLint の no-restricted-globals)、fetch を使うのはこのファイルと samples.ts・ai-client.ts だけ。
import type { WorkerLike } from "./analysis-controller";

let scriptUrl: Promise<string> | null = null;

export function loadEngineScript(url: string): Promise<string> {
  if (!scriptUrl) {
    const loading = fetch(url, { credentials: "same-origin" }).then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      return URL.createObjectURL(new Blob([blob], { type: "text/javascript" }));
    });
    // 失敗したら次の依頼で取り直す
    loading.catch(() => {
      if (scriptUrl === loading) scriptUrl = null;
    });
    scriptUrl = loading;
  }
  return scriptUrl;
}

export function browserWorkerFactory(url: string): () => Promise<WorkerLike> {
  return async () => new Worker(await loadEngineScript(url), { name: "inventory-engine" }) as unknown as WorkerLike;
}
