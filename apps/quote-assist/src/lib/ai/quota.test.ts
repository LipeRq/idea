import { describe, expect, it } from "vitest";
import { aiDailyLimitFromEnv, createAiQuota, DEFAULT_AI_DAILY_LIMIT } from "./quota";

describe("AIの1日の上限", () => {
  it("上限までは確保でき、超えたら false。日本時間の日付が変わったら数え直す", () => {
    const quota = createAiQuota(2);
    const day1 = new Date("2026-10-19T14:00:00Z"); // 日本時間 10/19 23:00
    expect([quota.reserve(day1), quota.reserve(day1), quota.reserve(day1)]).toEqual([true, true, false]);
    expect(quota.reserve(new Date("2026-10-19T15:00:00Z"))).toBe(true); // 日本時間 10/20 0:00
  });

  it("環境変数: 未設定は既定値、0 は使わない、読み取れない値は 0", () => {
    expect(aiDailyLimitFromEnv({})).toBe(DEFAULT_AI_DAILY_LIMIT);
    expect(aiDailyLimitFromEnv({ QUOTE_ASSIST_AI_DAILY_LIMIT: "50" })).toBe(50);
    expect(aiDailyLimitFromEnv({ QUOTE_ASSIST_AI_DAILY_LIMIT: "0" })).toBe(0);
    expect(aiDailyLimitFromEnv({ QUOTE_ASSIST_AI_DAILY_LIMIT: "abc" })).toBe(0);
    expect(aiDailyLimitFromEnv({ QUOTE_ASSIST_AI_DAILY_LIMIT: "-1" })).toBe(0);
    expect(createAiQuota(0).reserve(new Date())).toBe(false);
  });
});
