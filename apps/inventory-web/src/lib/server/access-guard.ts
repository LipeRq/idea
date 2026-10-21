import { createHash } from "node:crypto";
import { incrementWithExpiry, upstashConfigFromEnv } from "./kv/upstash";
import type { LimitDecision } from "./rate-limit";

// アクセスコードの総当たり対策。誤ったコードの試行を、送信元ごとと、サイト全体で1時間ごとに数え、
// 上限に達したら(正しいコードでも)しばらく受け付けない。Upstash があればインスタンスをまたいで数える。
// 共有ストアに接続できないときは受け付けない(フェイルクローズ)。

const WINDOW_MS = 60 * 60 * 1000;
const failures = new Map<string, number[]>();

const hashKey = (key: string) => createHash("sha256").update(key).digest("base64url").slice(0, 22);

function memoryCount(key: string, now: number, add: boolean): number {
  const recent = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (add) recent.push(now);
  if (recent.length > 0) failures.set(key, recent);
  else failures.delete(key);
  return recent.length;
}

async function count(key: string, now: number, env: NodeJS.ProcessEnv, add: boolean): Promise<number> {
  const config = upstashConfigFromEnv(env);
  if (!config) return memoryCount(key, now, add);
  // amount 0 は「今の値を読む」(キーが無ければ期限付きの0を置く)
  return incrementWithExpiry(config, `ai-access-fail:${key}`, WINDOW_MS, add ? 1 : 0);
}

export interface AccessGuardLimits {
  perSource: number;
  site: number;
}

/** 誤ったコードの試行が上限に達していれば limited */
export async function accessCodeLocked(
  source: string,
  limits: AccessGuardLimits,
  now: number = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<LimitDecision> {
  try {
    const [mine, site] = await Promise.all([count(`src:${hashKey(source)}`, now, env, false), count("site", now, env, false)]);
    return mine >= limits.perSource || site >= limits.site ? "limited" : "ok";
  } catch {
    return "unavailable";
  }
}

/** 誤ったコードの試行を1回数える */
export async function recordAccessCodeFailure(source: string, now: number = Date.now(), env: NodeJS.ProcessEnv = process.env): Promise<void> {
  try {
    await Promise.all([count(`src:${hashKey(source)}`, now, env, true), count("site", now, env, true)]);
  } catch {
    // 数えられなくても、次の確認(accessCodeLocked)が共有ストアの障害で受け付けない
  }
}

/** テスト用 */
export function resetAccessGuardForTest(): void {
  failures.clear();
}
