import { createHash } from "node:crypto";
import { incrementWithExpiry, upstashConfigFromEnv } from "./kv/upstash";

// 送信元ごとの回数制限。
// Upstash Redis が設定されていればインスタンスをまたいで数え(サーバーレスでも効く)、
// なければサーバーのインスタンス内のメモリで数える。共有ストアに接続できないときもメモリで数える。

const WINDOW_MS = 60 * 60 * 1000;
// 期限切れのキーを消す間隔。消さないとアクセス元が増えるたびにメモリが増え続ける
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

/** 上限を超えていれば true。超えていなければ回数に数えて false */
export type RateLimiter = (key: string, now?: number) => boolean;

/** 共有ストアを使う版。上限を超えていれば true */
export type SharedRateLimiter = (key: string) => Promise<boolean>;

/** 環境変数の値が正の整数ならそれを、そうでなければ既定値を返す */
export function limitFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * インスタンス内のメモリで、同じキー(送信元)から1時間に何回まで受け付けるかを数える。
 * 上限は呼び出しのたびに環境変数から読むので、再起動せずにテストや運用で変えられる。
 */
export function createRateLimiter(envName: string, defaultLimit: number): RateLimiter {
  const hits = new Map<string, number[]>();
  let lastSweep = 0;

  return (key, now = Date.now()) => {
    if (now - lastSweep >= SWEEP_INTERVAL_MS) {
      for (const [k, times] of hits) {
        if (now - times[times.length - 1] >= WINDOW_MS) hits.delete(k);
      }
      lastSweep = now;
    }

    const limit = limitFromEnv(envName, defaultLimit);
    const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return true;
    }
    recent.push(now);
    hits.set(key, recent);
    return false;
  };
}

/** 共有ストアのキーにはIPアドレスをそのまま置かない */
function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("base64url").slice(0, 22);
}

/**
 * Upstash Redis があれば共有ストアで、なければメモリで数える回数制限。
 * 共有ストアでは最初のリクエストから1時間の固定の枠で数える。
 */
export function createSharedRateLimiter(
  name: string,
  envName: string,
  defaultLimit: number,
): SharedRateLimiter {
  const memory = createRateLimiter(envName, defaultLimit);

  return async (key) => {
    let config;
    try {
      config = upstashConfigFromEnv();
    } catch (error) {
      console.error(`回数制限の共有ストアの設定に誤りがあります:${errorMessage(error)}`);
      return memory(key);
    }
    if (!config) return memory(key);

    try {
      const count = await incrementWithExpiry(config, `rl:${name}:${hashKey(key)}`, WINDOW_MS);
      return count > limitFromEnv(envName, defaultLimit);
    } catch (error) {
      console.error(
        `回数制限の共有ストアに接続できなかったため、このインスタンス内で数えます(${name}):${errorMessage(error)}`,
      );
      return memory(key);
    }
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 診断(AIを呼ぶので最も厳しく) */
export const isDiagnoseRateLimited = createSharedRateLimiter(
  "diagnose",
  "RATE_LIMIT_DIAGNOSE_PER_HOUR",
  5,
);
/** PDFレポートの作成 */
export const isReportRateLimited = createSharedRateLimiter(
  "report",
  "RATE_LIMIT_REPORT_PER_HOUR",
  30,
);
/** 無料相談の申し込み */
export const isLeadRateLimited = createSharedRateLimiter("lead", "RATE_LIMIT_LEAD_PER_HOUR", 5);
