import { afterEach, describe, expect, it, vi } from "vitest";
import { createHourlyLimiter, createMemoryRateLimiter, HOUR_MS, limitFromEnv } from "./rate-limit";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createMemoryRateLimiter", () => {
  it("1時間に上限回数までは通し、超えたら止める。キーごとに数える", () => {
    const isLimited = createMemoryRateLimiter();
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) expect(isLimited("a", 5, t0 + i)).toBe(false);
    expect(isLimited("a", 5, t0 + 10)).toBe(true);
    expect(isLimited("b", 5, t0 + 10)).toBe(false);
  });

  it("最初のリクエストから1時間たてば再び通す", () => {
    const isLimited = createMemoryRateLimiter();
    const t0 = 5_000_000;
    for (let i = 0; i < 5; i++) isLimited("c", 5, t0 + i);
    expect(isLimited("c", 5, t0 + HOUR_MS - 1)).toBe(true);
    expect(isLimited("c", 5, t0 + HOUR_MS)).toBe(false);
  });

  it("期限切れのキーを掃除しても、有効な回数は数え続ける", () => {
    const isLimited = createMemoryRateLimiter();
    const t0 = 10 * HOUR_MS;
    for (let i = 0; i < 100; i++) {
      for (let j = 0; j < 5; j++) isLimited(`old-${i}`, 5, t0);
    }
    for (let i = 0; i < 5; i++) isLimited("d", 5, t0 + HOUR_MS / 2);
    // 掃除が走る時刻。old-* は期限切れ、d はまだ1時間以内
    const later = t0 + HOUR_MS + 1;
    expect(isLimited("d", 5, later)).toBe(true);
    expect(isLimited("old-0", 5, later)).toBe(false);
  });

  it("上限は呼び出しのたびに渡す", () => {
    const isLimited = createMemoryRateLimiter();
    expect(isLimited("e", 2, 0)).toBe(false);
    expect(isLimited("e", 2, 1)).toBe(false);
    expect(isLimited("e", 2, 2)).toBe(true);
    expect(isLimited("e", 100, 3)).toBe(false);
  });

  it("リミッターごとに別々に数え、reset で消える", () => {
    const a = createMemoryRateLimiter();
    const b = createMemoryRateLimiter();
    expect(a("x", 1, 0)).toBe(false);
    expect(a("x", 1, 1)).toBe(true);
    expect(b("x", 1, 1)).toBe(false);
    a.reset();
    expect(a("x", 1, 2)).toBe(false);
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
    const env: NodeJS.ProcessEnv = { NODE_ENV: "test", ...(value !== undefined ? { LIMIT_PER_HOUR: value } : {}) };
    expect(limitFromEnv("LIMIT_PER_HOUR", 5, env)).toBe(expected);
  });
});

describe("createHourlyLimiter", () => {
  const noStore: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  const store: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "token",
  };
  const badStore: NodeJS.ProcessEnv = { ...store, UPSTASH_REDIS_REST_URL: "redis://example.upstash.io" };

  function upstashCount(count: number) {
    return new Response(JSON.stringify([{ result: null }, { result: count }]), { status: 200 });
  }

  it.each(["memory", "unavailable"] as const)("Upstash が未設定なら外部に接続せず、メモリで数える(%s)", async (onStoreError) => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const check = createHourlyLimiter({ name: "test", keyPrefix: "ai-app:", onStoreError });

    expect(await check("192.0.2.1", 2, { env: noStore })).toBe("ok");
    expect(await check("192.0.2.1", 2, { env: noStore })).toBe("ok");
    expect(await check("192.0.2.1", 2, { env: noStore })).toBe("limited");
    expect(await check("192.0.2.2", 2, { env: noStore })).toBe("ok");
    expect(fetchMock).not.toHaveBeenCalled();
    check.reset();
    expect(await check("192.0.2.1", 2, { env: noStore })).toBe("ok");
  });

  it("共有ストアの回数で判断し、上限を超えたら止める", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(upstashCount(3))
      .mockResolvedValueOnce(upstashCount(4));
    const check = createHourlyLimiter({ name: "test", keyPrefix: "ai-app:", onStoreError: "memory" });

    expect(await check("192.0.2.10", 3, { env: store })).toBe("ok");
    expect(await check("192.0.2.10", 3, { env: store })).toBe("limited");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("キーは接頭辞と名前で分け、IPアドレスはそのまま置かない(1時間で消える)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(upstashCount(1));
    await createHourlyLimiter({ name: "diagnose", keyPrefix: "ai-app:", onStoreError: "memory" })("192.0.2.10", 5, { env: store });
    await createHourlyLimiter({ name: "lead", keyPrefix: "ai-app:", onStoreError: "memory" })("192.0.2.10", 5, { env: store });

    const [first, second] = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)) as string[][]);
    expect(first[0][1]).toMatch(/^ai-app:rl:diagnose:[\w-]{22}$/);
    expect(second[0][1]).toMatch(/^ai-app:rl:lead:[\w-]{22}$/);
    expect(first[0][1].split(":").at(-1)).toBe(second[0][1].split(":").at(-1));
    expect(JSON.stringify([first, second])).not.toContain("192.0.2.10");
    expect(first[0]).toEqual(["SET", first[0][1], "0", "PX", String(HOUR_MS), "NX"]);
    expect(first[1]).toEqual(["INCR", first[0][1]]);
  });

  describe("共有ストアに接続できない・設定に誤りがあるとき", () => {
    it("memory: ログを出してメモリで数える", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
      const check = createHourlyLimiter({ name: "test", keyPrefix: "ai-app:", onStoreError: "memory" });

      expect(await check("192.0.2.20", 1, { env: store })).toBe("ok");
      expect(await check("192.0.2.20", 1, { env: store })).toBe("limited");
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("fetch failed"));
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("このインスタンス内で数えます(test)"));
    });

    it("memory: URLの設定に誤りがあれば、接続せずにログを出してメモリで数える", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const fetchMock = vi.spyOn(globalThis, "fetch");
      const check = createHourlyLimiter({ name: "test", keyPrefix: "ai-app:", onStoreError: "memory" });

      expect(await check("192.0.2.30", 1, { env: badStore })).toBe("ok");
      expect(await check("192.0.2.30", 1, { env: badStore })).toBe("limited");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("設定に誤り"));
    });

    it("unavailable: メモリに切り替えずに受け付けない(費用の歯止めを外さない)", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
      const check = createHourlyLimiter({ name: "ai-document", keyPrefix: "ai-app:", onStoreError: "unavailable" });

      expect(await check("192.0.2.40", 5, { env: store })).toBe("unavailable");
      expect(await check("192.0.2.40", 5, { env: badStore })).toBe("unavailable");
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("受け付けませんでした(ai-document)"));
      // 受け付けなかった分はメモリにも数えない
      expect(await check("192.0.2.40", 1, { env: noStore })).toBe("ok");
    });
  });
});
