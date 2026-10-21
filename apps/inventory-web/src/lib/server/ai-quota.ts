import { incrementWithExpiry, upstashConfigFromEnv } from "./kv/upstash";
import type { LimitDecision } from "./rate-limit";

// AI 版の1日の上限(サイト全体)。回数(INVENTORY_AI_DAILY_LIMIT)と推定入力トークン(INVENTORY_AI_DAILY_INPUT_TOKENS)の両方で数える。
// 入力の検証の後、Claude を呼ぶ前に数える(失敗した依頼も数える)。日付は日本時間で区切る。
// 共有ストアが設定されているのに接続できないときは受け付けない(フェイルクローズ)。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const KEY_TTL_MS = 2 * 24 * 60 * 60 * 1000;

let memory = { day: "", count: 0, tokens: 0 };

/** 日本時間の日付(YYYY-MM-DD) */
export function jstDay(now: Date): string {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

export async function reserveDailyAi(
  estimatedTokens: number,
  limits: { dailyLimit: number; dailyInputTokens: number },
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<LimitDecision> {
  if (limits.dailyLimit <= 0 || limits.dailyInputTokens <= 0) return "limited";
  const day = jstDay(now);
  let count: number;
  let tokens: number;
  try {
    const config = upstashConfigFromEnv(env);
    if (config) {
      count = await incrementWithExpiry(config, `ai-daily:count:${day}`, KEY_TTL_MS);
      tokens = await incrementWithExpiry(config, `ai-daily:tokens:${day}`, KEY_TTL_MS, estimatedTokens);
    } else {
      if (memory.day !== day) memory = { day, count: 0, tokens: 0 };
      count = ++memory.count;
      tokens = memory.tokens += estimatedTokens;
    }
  } catch (error) {
    console.error(`AI版の1日の利用量を数えられなかったため、依頼を受け付けませんでした: ${error instanceof Error ? error.message : String(error)}`);
    return "unavailable";
  }
  if (count > limits.dailyLimit || tokens > limits.dailyInputTokens) {
    if (count === limits.dailyLimit + 1) console.warn(`本日(${day})のAI版の受付が上限に達しました`);
    return "limited";
  }
  return "ok";
}

/** テスト用 */
export function resetAiQuotaForTest(): void {
  memory = { day: "", count: 0, tokens: 0 };
}
