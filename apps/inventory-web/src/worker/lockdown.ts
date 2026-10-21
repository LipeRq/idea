// Worker の入口で「最初に」評価するモジュール(engine.worker.ts の先頭で import する。ES Module の評価順で、
// エンジンの schema.ts が zod のスキーマを作るより前に実行される)。
// 1. zod が eval を使えるか試す処理(new Function)を止める。CSP で eval を禁止しているため、試すだけで違反の報告が出る。
//    zod の設定は globalThis.__zod_globalConfig で共有されるので、エンジン側の zod にも効く。
// 2. 通信・別のスクリプトの実行・保存に使える API を Worker から消す。グローバル(self)だけでなく、プロトタイプの
//    すべての段(DedicatedWorkerGlobalScope.prototype など)にある元の定義も置き換える(self の上書きだけだと、
//    プロトタイプの fetch を .call(self) で呼べてしまうため)。
//    これは二重目の守り。一重目は Worker のスクリプトの CSP(connect-src / script-src / worker-src 'none')で、ブラウザが止める。
// 3. CSP の違反が起きたら画面に知らせる(画面が件数を data 属性に出す。E2E と自己点検用。通信はしない)。
import { workerScope } from "./scope";

type ZodGlobal = { __zod_globalConfig?: Record<string, unknown> };
const g = globalThis as typeof globalThis & ZodGlobal;
g.__zod_globalConfig = { ...(g.__zod_globalConfig ?? {}), jitless: true };

// 名前は文字列で持つ(バンドルの検査は「呼び出しの形」を探すため、ここでの列挙には反応しない)
export const BLOCKED_GLOBALS = [
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "WebTransport",
  "importScripts",
  "Worker",
  "SharedWorker",
  "caches",
  "CacheStorage",
  "indexedDB",
  "BroadcastChannel",
];
const BLOCKED_NAVIGATOR = ["sendBeacon", "serviceWorker", "storage"];

function blocked(): never {
  throw new Error("解析プログラムからの通信は禁止されています");
}

/** obj とそのプロトタイプのすべての段で、names の定義を「呼ぶと失敗する」ものに置き換える */
function neutralize(obj: object | null | undefined, names: string[]) {
  for (let p: object | null = obj ?? null; p; p = Object.getPrototypeOf(p)) {
    for (const name of names) {
      if (!Object.prototype.hasOwnProperty.call(p, name)) continue;
      try {
        Object.defineProperty(p, name, { get: () => blocked, set: () => undefined, configurable: false, enumerable: false });
      } catch {
        // 変更できない定義は残る(CSP が止める)
      }
    }
  }
}

neutralize(self, BLOCKED_GLOBALS);
neutralize((self as { navigator?: object }).navigator, BLOCKED_NAVIGATOR);

const scope = workerScope();
scope.addEventListener("securitypolicyviolation", (event) => {
  scope.postMessage({ type: "csp", directive: event.violatedDirective });
});
