import { createHash } from "node:crypto";
import { incrementWithExpiry, upstashConfigFromEnv } from "./kv/upstash";

// 送信元ごとの1時間あたりの回数制限(apps/diagnosis の src/lib/rate-limit.ts をもとにしている)。
// Upstash Redis が設定されていればインスタンスをまたいで数える。設定が無いときはインスタンス内のメモリで数える
// (本番で共有ストアが必須の設定では、ai-config.ts が AI 版そのものを無効にする)。
// 共有ストアが設定されているのに接続できないときは、メモリに切り替えずに「受け付けない」(費用の歯止めを外さない)。

const WINDOW_MS = 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

export type LimitDecision = "ok" | "limited" | "unavailable";

const hits = new Map<string, number[]>();
let lastSweep = 0;

function memoryCheck(key: string, limit: number, now: number): LimitDecision {
  if (now - lastSweep >= SWEEP_INTERVAL_MS) {
    for (const [k, times] of hits) {
      if (now - times[times.length - 1] >= WINDOW_MS) hits.delete(k);
    }
    lastSweep = now;
  }
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return "limited";
  }
  recent.push(now);
  hits.set(key, recent);
  return "ok";
}

/** 共有ストアのキーにはIPアドレスをそのまま置かない */
function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("base64url").slice(0, 22);
}

export async function checkHourlyLimit(
  key: string,
  limit: number,
  now: number = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<LimitDecision> {
  let config;
  try {
    config = upstashConfigFromEnv(env);
  } catch {
    return "unavailable";
  }
  if (!config) return memoryCheck(key, limit, now);
  try {
    const count = await incrementWithExpiry(config, `rl:ai-document:${hashKey(key)}`, WINDOW_MS);
    return count > limit ? "limited" : "ok";
  } catch (error) {
    console.error(`回数制限の共有ストアに接続できなかったため、AI版の依頼を受け付けませんでした: ${error instanceof Error ? error.message : String(error)}`);
    return "unavailable";
  }
}

/** テスト用 */
export function resetRateLimitForTest(): void {
  hits.clear();
  lastSweep = 0;
}
