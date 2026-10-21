// 解析 Worker を起動する。
// Worker はスクリプトの URL(/engine/inventory-worker-<ハッシュ>.js)から起動する。このスクリプトの応答には、
// 通信・スクリプトの読み込み・Worker の作成をすべて禁止する CSP が付く(src/lib/security-headers.ts の WORKER_SCRIPT_CSP)ので、
// 解析プログラムからはブラウザの機能として一切通信できない。
// ファイル名に内容のハッシュが入り長期キャッシュされるので、ページを開いた後にネットワークを切っても、
// ブラウザのキャッシュから Worker を作り直せる。
import type { WorkerLike } from "./analysis-controller";

export function browserWorkerFactory(url: string): () => WorkerLike {
  return () => new Worker(url, { name: "inventory-engine" }) as unknown as WorkerLike;
}
