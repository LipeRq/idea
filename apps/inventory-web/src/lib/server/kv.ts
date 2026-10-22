import { upstashConfigFromEnv, type UpstashConfig } from "@idea/shared/kv/upstash";

// 共有ストア(Upstash Redis)の設定。仕組みは packages/shared の kv/upstash.ts。
// 他のアプリと同じデータベースを使っても衝突しないよう、キーに付ける
export const KV_KEY_PREFIX = "ai-inventory:";

/** 未設定なら null(共有ストアを使わない)。URLの形式が誤っていれば例外 */
export function kvConfigFromEnv(env: NodeJS.ProcessEnv = process.env): UpstashConfig | null {
  return upstashConfigFromEnv(KV_KEY_PREFIX, env);
}
