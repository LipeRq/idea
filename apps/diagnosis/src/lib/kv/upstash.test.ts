import { afterEach, describe, expect, it, vi } from "vitest";
import { incrementWithExpiry, upstashConfigFromEnv, upstashTransaction } from "./upstash";

const config = { url: "https://example-123.upstash.io", token: "token-abc" };

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(body: unknown, status = 200) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

describe("upstashConfigFromEnv", () => {
  it("URLとトークンの両方がなければ使わない(null)", () => {
    expect(upstashConfigFromEnv({ NODE_ENV: "test" })).toBeNull();
    expect(
      upstashConfigFromEnv({ NODE_ENV: "test", UPSTASH_REDIS_REST_URL: config.url }),
    ).toBeNull();
    expect(
      upstashConfigFromEnv({ NODE_ENV: "test", UPSTASH_REDIS_REST_TOKEN: config.token }),
    ).toBeNull();
  });

  it("UPSTASH_REDIS_REST_* を読み、末尾のスラッシュは取る", () => {
    expect(
      upstashConfigFromEnv({
        NODE_ENV: "test",
        UPSTASH_REDIS_REST_URL: ` ${config.url}/ `,
        UPSTASH_REDIS_REST_TOKEN: config.token,
      }),
    ).toEqual(config);
  });

  it("Vercel の Marketplace が設定する KV_REST_API_* でもよい", () => {
    expect(
      upstashConfigFromEnv({
        NODE_ENV: "test",
        KV_REST_API_URL: config.url,
        KV_REST_API_TOKEN: config.token,
      }),
    ).toEqual(config);
  });

  it("https でないURLは設定の誤りとして例外にする", () => {
    expect(() =>
      upstashConfigFromEnv({
        NODE_ENV: "test",
        UPSTASH_REDIS_REST_URL: "http://example.upstash.io",
        UPSTASH_REDIS_REST_TOKEN: config.token,
      }),
    ).toThrow("https://");
  });
});

describe("upstashTransaction", () => {
  it("multi-exec にコマンドの配列をトークン付きで送り、各結果を返す", async () => {
    const fetchMock = mockFetch([{ result: "OK" }, { result: 3 }]);

    const results = await upstashTransaction(config, [
      ["SET", "k", "0"],
      ["INCR", "k"],
    ]);

    expect(results).toEqual(["OK", 3]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example-123.upstash.io/multi-exec");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer token-abc");
    expect(JSON.parse(String(init?.body))).toEqual([
      ["SET", "k", "0"],
      ["INCR", "k"],
    ]);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ["HTTPエラー", { error: "WRONGPASS" }, 401, "HTTP 401"],
    ["コマンドのエラー", [{ result: "OK" }, { error: "ERR value is not an integer" }], 200, "ERR value"],
    ["件数が合わない応答", [{ result: "OK" }], 200, "読み取れません"],
    ["配列でない応答", { result: 1 }, 200, "読み取れません"],
  ])("%sは例外にする", async (_, body, status, message) => {
    mockFetch(body, status);
    await expect(
      upstashTransaction(config, [
        ["SET", "k", "0"],
        ["INCR", "k"],
      ]),
    ).rejects.toThrow(message);
  });

  it("通信エラーはそのまま例外になる", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    await expect(upstashTransaction(config, [["INCR", "k"]])).rejects.toThrow("fetch failed");
  });
});

describe("incrementWithExpiry", () => {
  it("期限付きで0を置いて(NX)から1増やし、増やした後の値を返す。キーには接頭辞を付ける", async () => {
    const fetchMock = mockFetch([{ result: null }, { result: 6 }]);

    expect(await incrementWithExpiry(config, "rl:diagnose:abc", 3_600_000)).toBe(6);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual([
      ["SET", "ai-diagnosis:rl:diagnose:abc", "0", "PX", "3600000", "NX"],
      ["INCR", "ai-diagnosis:rl:diagnose:abc"],
    ]);
  });

  it("INCR の結果が数値でなければ例外にする", async () => {
    mockFetch([{ result: "OK" }, { result: "x" }]);
    await expect(incrementWithExpiry(config, "k", 1000)).rejects.toThrow("数値ではありません");
  });
});
