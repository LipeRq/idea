import { todayJst } from "../dates";

// AI(Claude API)の呼び出しの1日の上限。誤って公開したときや、同じ操作の繰り返しで費用が膨らまないようにする歯止め。
// 読み取り(1件の登録で1回)と工数案(1回の見積で1回)をそれぞれ1回と数える。
// 日本時間の日付ごとに、このプロセスのメモリで数える。再起動で数え直し、複数のインスタンスではそれぞれで数えるので、
// 厳密な上限ではない(厳密に止めるなら、Anthropic Console の利用上限も設定する)。

type Env = Record<string, string | undefined>;

export const DEFAULT_AI_DAILY_LIMIT = 200;

export type AiQuota = {
  readonly limit: number;
  /** 1回分を確保する。上限に達していれば false */
  reserve(now: Date): boolean;
};

/** QUOTE_ASSIST_AI_DAILY_LIMIT。未設定は既定値、0 は AI を使わない。読み取れない値も 0(使わない)として扱う */
export function aiDailyLimitFromEnv(env: Env = process.env): number {
  const raw = env.QUOTE_ASSIST_AI_DAILY_LIMIT?.trim();
  if (!raw) return DEFAULT_AI_DAILY_LIMIT;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}

export function createAiQuota(limit: number): AiQuota {
  let day = "";
  let count = 0;
  return {
    limit,
    reserve(now) {
      const today = todayJst(now);
      if (today !== day) {
        day = today;
        count = 0;
      }
      if (count >= limit) return false;
      count++;
      return true;
    },
  };
}
