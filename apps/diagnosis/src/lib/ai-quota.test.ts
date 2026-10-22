import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiDailyLimit, reserveAiCall, resetAiQuotaForTest } from "./ai-quota";

const env = (values: Record<string, string>): NodeJS.ProcessEnv => ({ NODE_ENV: "test", ...values });
const noon = new Date("2026-10-18T03:00:00Z"); // 日本時間 12:00

beforeEach(() => {
  resetAiQuotaForTest();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("aiDailyLimit", () => {
  it.each([
    ["未設定", {}, { kind: "unlimited" }],
    ["空文字", { AI_DAILY_LIMIT: " " }, { kind: "unlimited" }],
    ["正の整数", { AI_DAILY_LIMIT: "200" }, { kind: "limited", limit: 200 }],
    ["0(AIを使わない)", { AI_DAILY_LIMIT: "0" }, { kind: "limited", limit: 0 }],
  ])("%s", (_, values, expected) => {
    expect(aiDailyLimit(env(values))).toEqual(expected);
  });

  it.each(["many", "-1", "2.5"])("読めない値(%s)は、費用を抑える側に倒して0にし、ログに出す", (value) => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(aiDailyLimit(env({ AI_DAILY_LIMIT: value }))).toEqual({ kind: "limited", limit: 0 });
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("AI_DAILY_LIMIT"));
  });
});

describe("reserveAiCall(メモリで数える)", () => {
  it("上限が未設定なら常に呼んでよい", async () => {
    for (let i = 0; i < 50; i++) {
      expect(await reserveAiCall(noon, env({}))).toBe(true);
    }
  });

  it("上限の回数までは呼んでよく、超えたら呼ばない。超えたときに1回だけ警告を出す", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const limited = env({ AI_DAILY_LIMIT: "3" });
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await reserveAiCall(noon, limited));

    expect(results).toEqual([true, true, true, false, false]);
    expect(consoleWarn).toHaveBeenCalledTimes(1);
    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining("上限(3回)"));
  });

  it("日本時間で日付が変わると数え直す", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const limited = env({ AI_DAILY_LIMIT: "1" });
    expect(await reserveAiCall(new Date("2026-10-18T14:00:00Z"), limited)).toBe(true);
    expect(await reserveAiCall(new Date("2026-10-18T14:59:00Z"), limited)).toBe(false);
    expect(await reserveAiCall(new Date("2026-10-18T15:00:00Z"), limited)).toBe(true);
  });

  it("0ならAIを呼ばない", async () => {
    expect(await reserveAiCall(noon, env({ AI_DAILY_LIMIT: "0" }))).toBe(false);
  });
});

describe("reserveAiCall(Upstash で数える)", () => {
  const upstash = (limit: string) =>
    env({
      AI_DAILY_LIMIT: limit,
      UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "token",
    });

  it("日本時間の日付のキーで数え、2日で消えるようにする", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify([{ result: "OK" }, { result: 10 }])));

    expect(await reserveAiCall(new Date("2026-10-18T15:30:00Z"), upstash("10"))).toBe(true);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual([
      ["SET", "ai-diagnosis:ai-daily:2026-10-19", "0", "PX", String(2 * 24 * 60 * 60 * 1000), "NX"],
      ["INCR", "ai-diagnosis:ai-daily:2026-10-19"],
    ]);
  });

  it("共有ストアの回数が上限を超えたら呼ばない", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ result: null }, { result: 11 }])),
    );
    expect(await reserveAiCall(noon, upstash("10"))).toBe(false);
  });

  it("共有ストアに接続できなければ、費用が膨らまないよう呼ばない", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    expect(await reserveAiCall(noon, upstash("10"))).toBe(false);
    expect(consoleError).toHaveBeenCalled();
  });

  it("上限が未設定なら共有ストアにも接続しない", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    expect(await reserveAiCall(noon, upstash(""))).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
