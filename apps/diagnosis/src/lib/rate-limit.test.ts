import { afterEach, describe, expect, it, vi } from "vitest";
import { createRateLimiter, limitFromEnv } from "./rate-limit";

const HOUR = 60 * 60 * 1000;
const ENV = "RATE_LIMIT_TEST_PER_HOUR";

afterEach(() => {
  vi.unstubAllEnvs();
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
