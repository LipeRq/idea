import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isHumanRequest,
  resetTurnstileWarningForTest,
  turnstileSecret,
  verifyTurnstileToken,
} from "./turnstile";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const enabledEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4AAAAAAA-site",
  TURNSTILE_SECRET_KEY: "0x4AAAAAAA-secret",
};

function siteverify(body: object, status = 200) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  resetTurnstileWarningForTest();
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("turnstileSecret", () => {
  it("サイトキーとシークレットの両方があるときだけ有効", () => {
    expect(turnstileSecret(enabledEnv)).toBe("0x4AAAAAAA-secret");
    expect(turnstileSecret({ NODE_ENV: "test" })).toBeNull();
  });

  it("片方だけなら無効にし、設定の誤りを1回だけログに出す", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(turnstileSecret({ NODE_ENV: "test", TURNSTILE_SECRET_KEY: "secret" })).toBeNull();
    expect(turnstileSecret({ NODE_ENV: "test", NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site" })).toBeNull();
    expect(consoleError).toHaveBeenCalledTimes(1);
  });
});

describe("verifyTurnstileToken", () => {
  const options = { secret: "secret", action: "diagnose" as const, remoteIp: "203.0.113.5" };

  it("トークンをシークレット・送信元IPと一緒に siteverify に送り、成功なら true", async () => {
    const fetchMock = siteverify({ success: true, action: "diagnose" });

    expect(await verifyTurnstileToken("token-1", options)).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(SITEVERIFY_URL);
    expect(init?.method).toBe("POST");
    const form = init?.body as URLSearchParams;
    expect(Object.fromEntries(form)).toEqual({
      secret: "secret",
      response: "token-1",
      remoteip: "203.0.113.5",
    });
  });

  it.each([
    ["トークンがない", null],
    ["トークンが長すぎる", "x".repeat(2049)],
  ])("%sなら検証せずに false", async (_, token) => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    expect(await verifyTurnstileToken(token, options)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("確認に失敗した(期限切れ・使用済みなど)なら false", async () => {
    siteverify({ success: false, "error-codes": ["timeout-or-duplicate"] });
    expect(await verifyTurnstileToken("token-1", options)).toBe(false);
  });

  it("別の画面(action)で取ったトークンは断る", async () => {
    siteverify({ success: true, action: "lead" });
    expect(await verifyTurnstileToken("token-1", options)).toBe(false);
  });

  it("シークレットが誤っているときは、設定の誤りとしてエラーログを出す", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    siteverify({ success: false, "error-codes": ["invalid-input-secret"] });
    expect(await verifyTurnstileToken("token-1", options)).toBe(false);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("TURNSTILE_SECRET_KEY"));
  });

  it("Cloudflare に接続できない・5xx のときは、利用者を締め出さないよう通す(ログは残す)", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await verifyTurnstileToken("token-1", options)).toBe(true);

    siteverify({}, 503);
    expect(await verifyTurnstileToken("token-1", options)).toBe(true);
    expect(consoleError).toHaveBeenCalledTimes(2);
  });
});

describe("isHumanRequest", () => {
  const request = (headers: Record<string, string> = {}) =>
    new Request("http://localhost/api/diagnose", {
      method: "POST",
      headers: { "x-vercel-forwarded-for": "203.0.113.9", "x-forwarded-for": "198.51.100.1, 10.0.0.1", ...headers },
    });

  it("Turnstile が無効なら外部に接続せず true", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    expect(await isHumanRequest(request(), "diagnose", { NODE_ENV: "test" })).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("有効なら X-Turnstile-Token ヘッダーのトークンを、送信元IPと一緒に検証する", async () => {
    const fetchMock = siteverify({ success: true, action: "lead" });
    expect(
      await isHumanRequest(request({ "x-turnstile-token": "token-2" }), "lead", { ...enabledEnv, VERCEL: "1" }),
    ).toBe(true);
    const form = fetchMock.mock.calls[0][1]?.body as URLSearchParams;
    expect(form.get("response")).toBe("token-2");
    expect(form.get("remoteip")).toBe("203.0.113.9");
  });

  it("送信元を信用できない環境では、送信元IPを送らない(x-forwarded-for は偽装できる)", async () => {
    const fetchMock = siteverify({ success: true, action: "lead" });
    expect(await isHumanRequest(request({ "x-turnstile-token": "token-3" }), "lead", enabledEnv)).toBe(true);
    const form = fetchMock.mock.calls[0][1]?.body as URLSearchParams;
    expect(form.get("remoteip")).toBeNull();
  });

  it("有効でトークンがなければ false", async () => {
    expect(await isHumanRequest(request(), "diagnose", enabledEnv)).toBe(false);
  });
});
