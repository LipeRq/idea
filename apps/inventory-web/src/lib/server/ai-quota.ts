import { createDailyCounter, jstDay } from "@idea/shared/daily-counter";
import { kvConfigFromEnv } from "./kv";
import type { LimitDecision } from "./rate-limit";

// AI 版の1日の上限(サイト全体)。回数(INVENTORY_AI_DAILY_LIMIT)と推定入力トークン(INVENTORY_AI_DAILY_INPUT_TOKENS)の両方で数える。
// 入力の検証の後、Claude を呼ぶ前に数える(失敗した依頼も数える)。日付は日本時間で区切る(数え方は packages/shared の daily-counter.ts)。
// 共有ストアが設定されているのに接続できないときは受け付けない(フェイルクローズ)。

const counter = createDailyCounter();

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
    const config = kvConfigFromEnv(env);
    count = await counter.add(config, "ai-daily:count", day);
    tokens = await counter.add(config, "ai-daily:tokens", day, estimatedTokens);
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
  counter.reset();
}
