// ビルドした(minify 済みの)解析 Worker のバンドルそのものを動かして確かめる。
// ソースを直接呼ぶ単体テストでは見つからない問題(minify でエラーのクラス名が変わる・zod が eval を試す)を防ぐ。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accessFixture, fakeFile, plainWorkbook } from "../src/test/fixtures";
import type { WorkerResponse } from "../src/worker/protocol";
import { bundleWorker, findForbidden } from "./build-worker.mjs";

interface FakeScope {
  listeners: Record<string, (event: unknown) => void>;
  out: WorkerResponse[];
  [key: string]: unknown;
}

let code = "";
const nodeBuffer = globalThis.Buffer;
afterAll(() => {
  globalThis.Buffer = nodeBuffer;
});
let scope: FakeScope;
const evalAttempts: string[] = [];

beforeAll(async () => {
  code = await bundleWorker();
  // ブラウザと同じく、通信の API はグローバルのプロトタイプ側に置く(self の上書きだけでは塞げない形)
  const sent: string[] = [];
  const proto = {
    fetch: (url: string) => sent.push(url),
    importScripts: (url: string) => sent.push(url),
    Worker: function Worker(url: string) {
      sent.push(url);
    },
    get caches() {
      return { open: () => sent.push("caches") };
    },
  };
  scope = Object.assign(Object.create(proto), {
    listeners: {},
    out: [],
    sent,
    navigator: Object.create({ sendBeacon: (url: string) => sent.push(url) }),
    addEventListener(type: string, fn: (event: unknown) => void) {
      scope.listeners[type] = fn;
    },
    postMessage(msg: WorkerResponse) {
      scope.out.push(msg);
    },
  });
  // Function を、呼ばれたら記録して失敗する偽物に差し替えて実行する(CSP で eval を禁止したときと同じ状況)
  const block = (what: string) => () => {
    evalAttempts.push(what);
    throw new EvalError("eval is blocked");
  };
  const FakeFunction = new Proxy(Function, { construct: block("new Function"), apply: block("Function()") });
  // ブラウザに無い Node.js のグローバル(Buffer・process)は見えないようにする
  // (エンジンは globalThis.Buffer が無いときだけ npm の buffer を置くので、Node.js の Buffer が見えると混ざってしまう)
  delete (globalThis as { Buffer?: unknown }).Buffer;
  new Function("self", "Function", "process", code)(scope, FakeFunction, undefined);
}, 60_000);

async function request(msg: Record<string, unknown>): Promise<WorkerResponse> {
  const id = Math.floor(Math.random() * 1e9);
  scope.listeners.message({ data: { ...msg, id } });
  for (let i = 0; i < 600; i++) {
    const found = scope.out.find((r) => "id" in r && r.id === id && r.type !== "phase");
    if (found) return found;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Worker から応答がない");
}

describe("解析 Worker のバンドル", () => {
  it("1MB 未満で、通信の API の呼び出しを含まない", () => {
    expect(code.length).toBeLessThan(1_000_000);
    expect(findForbidden(code)).toEqual([]);
  });

  it("起動すると ready を返し、プロトタイプの段も含めて通信の API を使えなくする", () => {
    expect(scope.out[0]).toMatchObject({ type: "ready" });
    const proto = Object.getPrototypeOf(scope) as Record<string, unknown>;
    const s = scope as Record<string, unknown>;
    expect(() => (s.fetch as (u: string) => void)("/x")).toThrow();
    expect(() => (proto.fetch as (u: string) => void).call(scope, "/x")).toThrow();
    expect(() => (proto.importScripts as (u: string) => void)("/x")).toThrow();
    expect(() => new (proto.Worker as new (u: string) => unknown)("/x")).toThrow();
    expect(() => (proto.caches as { open: () => void }).open()).toThrow();
    expect(() => (Object.getPrototypeOf(s.navigator) as { sendBeacon: (u: string) => void }).sendBeacon("/x")).toThrow();
    expect(scope.sent).toEqual([]);
  });

  it("minify 後も、壊れたファイルは corrupt、パスワード付き Access は encryptedAccess で返す", async () => {
    const bytes = plainWorkbook();
    const corrupt = await request({ type: "analyze", file: fakeFile(bytes.slice(0, bytes.length >> 1), "a.xlsm"), limits: {} });
    expect(corrupt).toMatchObject({ type: "error", error: { code: "corrupt" } });
    const encrypted = await request({ type: "analyze", file: fakeFile(accessFixture("V2010_with-password.accdb"), "p.accdb"), limits: {} });
    expect(encrypted).toMatchObject({ type: "error", error: { code: "encryptedAccess" } });
  });

  it("正常なファイルを解析でき、その間に new Function(eval の一種)を一度も試さない(zod の jitless)", async () => {
    const res = await request({ type: "analyze", file: fakeFile(plainWorkbook(), "b.xlsm"), limits: {} });
    expect(res.type).toBe("analyzed");
    expect(evalAttempts).toEqual([]);
  });
});
