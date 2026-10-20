import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRateLimiter, createSharedRateLimiter, limitFromEnv } from "./rate-limit";

const HOUR = 60 * 60 * 1000;
const ENV = "RATE_LIMIT_TEST_PER_HOUR";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("createRateLimiter", () => {
  it("1時間に上限回数までは通し、超えたら止める。キーごとに数える", () => {
    const isLimited = createRateLimiter(ENV, 5);
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) {
      expect(isLimited("a", t0 + i)).toBe(false);
    }
    expect(isLimited("a", t0 + 10)).toBe(true);
    expect(isLimited("b", t0 + 10)).toBe(false);
  });

  it("最初のリクエストから1時間たてば再び通す", () => {
    const isLimited = createRateLimiter(ENV, 5);
    const t0 = 5_000_000;
    for (let i = 0; i < 5; i++) isLimited("c", t0 + i);
    expect(isLimited("c", t0 + HOUR - 1)).toBe(true);
    expect(isLimited("c", t0 + HOUR)).toBe(false);
  });

  it("期限切れのキーを掃除しても、有効な回数は数え続ける", () => {
    const isLimited = createRateLimiter(ENV, 5);
    const t0 = 10 * HOUR;
    for (let i = 0; i < 100; i++) {
      for (let j = 0; j < 5; j++) isLimited(`old-${i}`, t0);
    }
    for (let i = 0; i < 5; i++) isLimited("d", t0 + HOUR / 2);
    // 掃除が走る時刻。old-* は期限切れ、d はまだ1時間以内
    const later = t0 + HOUR + 1;
    expect(isLimited("d", later)).toBe(true);
    expect(isLimited("old-0", later)).toBe(false);
  });

  it("上限は環境変数で変えられ、呼び出しのたびに読み直す", () => {
    const isLimited = createRateLimiter(ENV, 5);
    vi.stubEnv(ENV, "2");
    expect(isLimited("e", 0)).toBe(false);
    expect(isLimited("e", 1)).toBe(false);
    expect(isLimited("e", 2)).toBe(true);
    vi.stubEnv(ENV, "100");
    expect(isLimited("e", 3)).toBe(false);
  });

  it("リミッターごとに別々に数える", () => {
    const a = createRateLimiter(ENV, 1);
    const b = createRateLimiter(ENV, 1);
    expect(a("x", 0)).toBe(false);
    expect(a("x", 1)).toBe(true);
    expect(b("x", 1)).toBe(false);
  });
});

describe("limitFromEnv", () => {
  it.each([
    ["未設定", undefined, 5],
    ["空文字", "", 5],
    ["正の整数", "50", 50],
    ["0", "0", 5],
    ["負の数", "-1", 5],
    ["小数", "2.5", 5],
    ["数字でない", "many", 5],
  ])("%s → 既定値か設定値", (_, value, expected) => {
    if (value !== undefined) vi.stubEnv(ENV, value);
    expect(limitFromEnv(ENV, 5)).toBe(expected);
  });
});

describe("createSharedRateLimiter", () => {
  const SHARED_ENV = "RATE_LIMIT_SHARED_TEST_PER_HOUR";

  function upstashCount(count: number) {
    return new Response(JSON.stringify([{ result: null }, { result: count }]), { status: 200 });
  }

  it("Upstash が未設定なら外部に接続せず、メモリで数える", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("KV_REST_API_URL", "");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const isLimited = createSharedRateLimiter("test", SHARED_ENV, 2);

    expect(await isLimited("192.0.2.1")).toBe(false);
    expect(await isLimited("192.0.2.1")).toBe(false);
    expect(await isLimited("192.0.2.1")).toBe(true);
    expect(await isLimited("192.0.2.2")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("Upstash が設定されているとき", () => {
    beforeEach(() => {
      vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
      vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
    });

    it("共有ストアの回数で判断し、上限(環境変数で変更可)を超えたら止める", async () => {
      vi.stubEnv(SHARED_ENV, "3");
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(upstashCount(3))
        .mockResolvedValueOnce(upstashCount(4));
      const isLimited = createSharedRateLimiter("test", SHARED_ENV, 5);

      expect(await isLimited("192.0.2.10")).toBe(false);
      expect(await isLimited("192.0.2.10")).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("キーは名前ごとに分け、IPアドレスはそのまま置かない(1時間で消える)", async () => {
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(upstashCount(1));
      await createSharedRateLimiter("diagnose", SHARED_ENV, 5)("192.0.2.10");
      await createSharedRateLimiter("lead", SHARED_ENV, 5)("192.0.2.10");

      const [first, second] = fetchMock.mock.calls.map(
        (call) => JSON.parse(String(call[1]?.body)) as string[][],
      );
      expect(first[0][1]).toMatch(/^ai-diagnosis:rl:diagnose:[\w-]{22}$/);
      expect(second[0][1]).toMatch(/^ai-diagnosis:rl:lead:[\w-]{22}$/);
      expect(first[0][1].split(":").at(-1)).toBe(second[0][1].split(":").at(-1));
      expect(JSON.stringify([first, second])).not.toContain("192.0.2.10");
      expect(first[0]).toEqual(["SET", first[0][1], "0", "PX", String(HOUR), "NX"]);
    });

    it("共有ストアに接続できなければ、ログを出してメモリで数える", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
      const isLimited = createSharedRateLimiter("test", SHARED_ENV, 1);

      expect(await isLimited("192.0.2.20")).toBe(false);
      expect(await isLimited("192.0.2.20")).toBe(true);
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("fetch failed"));
    });

    it("URLの設定に誤りがあれば、ログを出してメモリで数える", async () => {
      vi.stubEnv("UPSTASH_REDIS_REST_URL", "redis://example.upstash.io");
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const fetchMock = vi.spyOn(globalThis, "fetch");

      expect(await createSharedRateLimiter("test", SHARED_ENV, 1)("192.0.2.30")).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("設定に誤り"));
    });
  });
});
