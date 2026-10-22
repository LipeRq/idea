import { createHourlyLimiter, type LimitDecision } from "@idea/shared/rate-limit";
import { KV_KEY_PREFIX } from "./kv";

// 送信元ごとの1時間あたりの回数制限(仕組みは packages/shared の rate-limit.ts。apps/diagnosis と同じ)。
// Upstash Redis が設定されていればインスタンスをまたいで数える。設定が無いときはインスタンス内のメモリで数える
// (本番で共有ストアが必須の設定では、ai-config.ts が AI 版そのものを無効にする)。
// 共有ストアが設定されているのに接続できないときは、メモリに切り替えずに「受け付けない」(費用の歯止めを外さない)。

export type { LimitDecision };

const aiDocumentLimiter = createHourlyLimiter({ name: "ai-document", keyPrefix: KV_KEY_PREFIX, onStoreError: "unavailable" });

export function checkHourlyLimit(
  key: string,
  limit: number,
  now: number = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<LimitDecision> {
  return aiDocumentLimiter(key, limit, { now, env });
}

/** テスト用 */
export function resetRateLimitForTest(): void {
  aiDocumentLimiter.reset();
}
