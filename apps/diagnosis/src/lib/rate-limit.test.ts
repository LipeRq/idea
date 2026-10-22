import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isDiagnoseRateLimited, isLeadRateLimited, isReportRateLimited } from "./rate-limit";

// 数え方そのものは packages/shared の rate-limit.test.ts で確かめる。ここはこのアプリの設定(環境変数名・既定の上限・
// 共有ストアのキー・接続できないときにメモリで数えること)を確かめる。

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function upstashCount(count: number) {
  return new Response(JSON.stringify([{ result: null }, { result: count }]), { status: 200 });
}

describe("回数制限(共有ストアなし)", () => {
  beforeEach(() => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("KV_REST_API_URL", "");
  });

  it("既定の上限は、診断・相談の申し込みが1時間に5回", async () => {
    for (const isLimited of [isDiagnoseRateLimited, isLeadRateLimited]) {
      for (let i = 0; i < 5; i++) expect(await isLimited("192.0.2.1")).toBe(false);
      expect(await isLimited("192.0.2.1")).toBe(true);
      expect(await isLimited("192.0.2.2")).toBe(false);
    }
  });

  it("上限は環境変数(RATE_LIMIT_REPORT_PER_HOUR など)で変えられ、呼び出しのたびに読み直す", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    vi.stubEnv("RATE_LIMIT_REPORT_PER_HOUR", "2");
    expect(await isReportRateLimited("192.0.2.3")).toBe(false);
    expect(await isReportRateLimited("192.0.2.3")).toBe(false);
    expect(await isReportRateLimited("192.0.2.3")).toBe(true);
    vi.stubEnv("RATE_LIMIT_REPORT_PER_HOUR", "100");
    expect(await isReportRateLimited("192.0.2.3")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("回数制限(Upstash が設定されているとき)", () => {
  beforeEach(() => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
  });

  it("キーはこのアプリの接頭辞と名前で分け、上限(環境変数で変更可)を超えたら止める", async () => {
    vi.stubEnv("RATE_LIMIT_DIAGNOSE_PER_HOUR", "3");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(upstashCount(3))
      .mockResolvedValueOnce(upstashCount(4))
      .mockResolvedValueOnce(upstashCount(1));

    expect(await isDiagnoseRateLimited("192.0.2.10")).toBe(false);
    expect(await isDiagnoseRateLimited("192.0.2.10")).toBe(true);
    expect(await isLeadRateLimited("192.0.2.10")).toBe(false);
    const keys = fetchMock.mock.calls.map((call) => (JSON.parse(String(call[1]?.body)) as string[][])[0][1]);
    expect(keys[0]).toMatch(/^ai-diagnosis:rl:diagnose:[\w-]{22}$/);
    expect(keys[2]).toMatch(/^ai-diagnosis:rl:lead:[\w-]{22}$/);
  });

  it("共有ストアに接続できなければ、ログを出してメモリで数える(受付は止めない)", async () => {
    vi.stubEnv("RATE_LIMIT_LEAD_PER_HOUR", "1");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));

    expect(await isLeadRateLimited("192.0.2.20")).toBe(false);
    expect(await isLeadRateLimited("192.0.2.20")).toBe(true);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("fetch failed"));
  });

  it("URLの設定に誤りがあれば、ログを出してメモリで数える", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "redis://example.upstash.io");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.spyOn(globalThis, "fetch");

    expect(await isReportRateLimited("192.0.2.30")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("設定に誤り"));
  });
});
