// Worker の入口で「最初に」評価するモジュール(engine.worker.ts の先頭で import する。ES Module の評価順で、
// エンジンの schema.ts が zod のスキーマを作るより前に実行される)。
// 1. zod が eval を使えるか試す処理(new Function)を止める。CSP で eval を禁止しているため、試すだけで違反の報告が出る。
//    zod の設定は globalThis.__zod_globalConfig で共有されるので、エンジン側の zod にも効く。
// 2. 通信に使える API を Worker から消す(解析プログラムからは何も送れないようにする。CSP の connect-src と二重の守り)。
// 3. CSP の違反が起きたら画面に知らせる(画面が件数を data 属性に出す。E2E と自己点検用。通信はしない)。
import { workerScope } from "./scope";

type ZodGlobal = { __zod_globalConfig?: Record<string, unknown> };
const g = globalThis as typeof globalThis & ZodGlobal;
g.__zod_globalConfig = { ...(g.__zod_globalConfig ?? {}), jitless: true };

// 文字列で持つ(バンドルの検査は「呼び出しの形」を探すため、ここでの名前の列挙には反応しない)
const NETWORK_APIS = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "WebTransport"];

function blocked(): never {
  throw new Error("解析プログラムからの通信は禁止されています");
}

for (const name of NETWORK_APIS) {
  try {
    Object.defineProperty(self, name, { value: blocked, writable: false, configurable: false });
  } catch {
    // 定義済みで変更できない環境では何もしない(CSP の connect-src が止める)
  }
}
const nav = (self as { navigator?: object }).navigator;
if (nav && "sendBeacon" in nav) {
  try {
    Object.defineProperty(nav, "sendBeacon", { value: blocked, writable: false, configurable: false });
  } catch {
    // 同上
  }
}

const scope = workerScope();
scope.addEventListener("securitypolicyviolation", (event) => {
  scope.postMessage({ type: "csp", directive: event.violatedDirective });
});
