import { describe, expect, it } from "vitest";
import { isRateLimited } from "./rate-limit";

const HOUR = 60 * 60 * 1000;

describe("isRateLimited", () => {
  it("1時間に5回までは通し、6回目から止める", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) {
      expect(isRateLimited("a", t0 + i)).toBe(false);
    }
    expect(isRateLimited("a", t0 + 10)).toBe(true);
    expect(isRateLimited("b", t0 + 10)).toBe(false);
  });

  it("最初のリクエストから1時間たてば再び通す", () => {
    const t0 = 5_000_000;
    for (let i = 0; i < 5; i++) isRateLimited("c", t0 + i);
    expect(isRateLimited("c", t0 + HOUR - 1)).toBe(true);
    expect(isRateLimited("c", t0 + HOUR)).toBe(false);
  });

  it("期限切れのキーを掃除しても、有効な回数は数え続ける", () => {
    const t0 = 10 * HOUR;
    for (let i = 0; i < 100; i++) {
      for (let j = 0; j < 5; j++) isRateLimited(`old-${i}`, t0);
    }
    for (let i = 0; i < 5; i++) isRateLimited("d", t0 + HOUR / 2);
    // 掃除が走る時刻。old-* は期限切れ、d はまだ1時間以内
    const later = t0 + HOUR + 1;
    expect(isRateLimited("d", later)).toBe(true);
    expect(isRateLimited("old-0", later)).toBe(false);
  });
});
