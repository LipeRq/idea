import { createHourlyLimiter, type LimitDecision } from "@idea/shared/rate-limit";
import { KV_KEY_PREFIX } from "./kv";

// 送信元ごとの1時間あたりの回数制限(仕組みは packages/shared の rate-limit.ts。apps/diagnosis と同じ)。
// Upstash Redis が設定されていればインスタンスをまたいで数える。設定が無いときはインスタンス内のメモリで数える
// (本番で共有ストアが必須の設定では、ai-config.ts が AI 版そのものを無効にする)。
// 共有ストアが設定されているのに接続できないときは、メモリに切り替えずに「受け付けない」(費用の歯止めを外さない)。

// 共有ストアのキーに置く送信元(IPアドレス)は、INVENTORY_RATE_LIMIT_HASH_SECRET を鍵にした HMAC-SHA256 にする
// (専用の秘密の値。アクセスコードなどは流用しない。本番で未設定なら警告し、鍵なしの SHA-256 で数える)。

export type { LimitDecision };

/** 送信元のハッシュの鍵を入れる環境変数(access-guard.ts と共通) */
export const RATE_LIMIT_HASH_SECRET_ENV = "INVENTORY_RATE_LIMIT_HASH_SECRET";

const aiDocumentLimiter = createHourlyLimiter({
  name: "ai-document",
  keyPrefix: KV_KEY_PREFIX,
  onStoreError: "unavailable",
  hashSecretEnv: RATE_LIMIT_HASH_SECRET_ENV,
});

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
