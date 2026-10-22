import { createHash, createHmac } from "node:crypto";
import { incrementWithExpiry, upstashConfigFromEnv } from "./kv/upstash";

// 送信元ごとの1時間あたりの回数制限(サーバー専用)。
// Upstash Redis が設定されていればインスタンスをまたいで数え(サーバーレスでも効く)、なければインスタンス内のメモリで数える。
// 共有ストアの設定の誤り・接続できないときの扱いはアプリごとに選ぶ(onStoreError)。
// - "memory": このインスタンス内のメモリで数える(受付を止めない。apps/diagnosis)
// - "unavailable": 受け付けない(費用の歯止めを外さない。apps/inventory-web の AI 版)

export const HOUR_MS = 60 * 60 * 1000;
// 期限切れのキーを消す間隔。消さないとアクセス元が増えるたびにメモリが増え続ける
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

export type LimitDecision = "ok" | "limited" | "unavailable";

/** 環境変数の値が正の整数ならそれを、そうでなければ既定値を返す */
export function limitFromEnv(name: string, fallback: number, env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * 共有ストアのキーにはIPアドレスをそのまま置かない。サーバーだけが知る鍵で HMAC-SHA256 にする
 * (鍵なしの SHA-256 では、IPv4 のように取りうる値が少ないと総当たりで元に戻せるため)。
 * 鍵が無いとき(未設定)は、以前と同じ鍵なしの SHA-256 にする(回数制限そのものは止めない)。
 */
export function hashClientKey(key: string, secret?: string): string {
  const hash = secret ? createHmac("sha256", secret) : createHash("sha256");
  return hash.update(key).digest("base64url").slice(0, 22);
}

const warnedSecretNames = new Set<string>();

/**
 * hashClientKey の鍵を環境変数 name から読む(アプリごとの専用の変数。他の用途の秘密の値は流用しない)。
 * 未設定なら undefined。本番(NODE_ENV=production)で未設定なら、変数ごとに1回だけ警告する。
 */
export function clientKeySecretFromEnv(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const secret = env[name]?.trim();
  if (secret) return secret;
  if (env.NODE_ENV === "production" && !warnedSecretNames.has(name)) {
    warnedSecretNames.add(name);
    console.warn(
      `${name} が未設定です。回数制限で共有ストアに置く送信元(IPアドレス)のハッシュが鍵なしになります。本番では設定してください(例:openssl rand -hex 32)`,
    );
  }
  return undefined;
}

/** 上限を超えていれば true。超えていなければ回数に数えて false */
export type MemoryRateLimiter = ((key: string, limit: number, now?: number) => boolean) & { reset(): void };

/** インスタンス内のメモリで、同じキー(送信元)から windowMs の間に何回まで受け付けるかを数える(直近 windowMs の回数) */
export function createMemoryRateLimiter(windowMs: number = HOUR_MS): MemoryRateLimiter {
  const hits = new Map<string, number[]>();
  let lastSweep = 0;

  const isLimited = (key: string, limit: number, now: number = Date.now()): boolean => {
    if (now - lastSweep >= SWEEP_INTERVAL_MS) {
      for (const [k, times] of hits) {
        if (now - times[times.length - 1] >= windowMs) hits.delete(k);
      }
      lastSweep = now;
    }
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return true;
    }
    recent.push(now);
    hits.set(key, recent);
    return false;
  };
  return Object.assign(isLimited, {
    reset() {
      hits.clear();
      lastSweep = 0;
    },
  });
}

export type HourlyLimiterOptions = {
  /** 共有ストアのキー(rl:<name>:<送信元の鍵付きハッシュ>)とログに使う名前 */
  name: string;
  /** 共有ストアのキーの接頭辞(アプリごと。例: "ai-diagnosis:") */
  keyPrefix: string;
  /** 共有ストアの設定に誤りがある・接続できないときに、メモリで数えるか、受け付けないか */
  onStoreError: "memory" | "unavailable";
  /** 送信元のハッシュ(hashClientKey)の鍵を入れる環境変数の名前(例: "DIAGNOSIS_RATE_LIMIT_HASH_SECRET") */
  hashSecretEnv: string;
};

export type HourlyLimiter = ((
  key: string,
  limit: number,
  options?: { now?: number; env?: NodeJS.ProcessEnv },
) => Promise<LimitDecision>) & { reset(): void };

/**
 * 1時間あたりの回数制限。共有ストアでは最初のリクエストから1時間の固定の枠で、メモリでは直近1時間で数える。
 * 上限は呼び出しのたびに渡す(環境変数から読み直せば、再起動せずに変えられる)。
 */
export function createHourlyLimiter({ name, keyPrefix, onStoreError, hashSecretEnv }: HourlyLimiterOptions): HourlyLimiter {
  const memory = createMemoryRateLimiter(HOUR_MS);
  const fallback = onStoreError === "memory" ? "このインスタンス内で数えます" : "受け付けませんでした";

  const check = async (
    key: string,
    limit: number,
    { now = Date.now(), env = process.env }: { now?: number; env?: NodeJS.ProcessEnv } = {},
  ): Promise<LimitDecision> => {
    const inMemory = (): LimitDecision => (memory(key, limit, now) ? "limited" : "ok");
    let config;
    try {
      config = upstashConfigFromEnv(keyPrefix, env);
    } catch (error) {
      console.error(`回数制限の共有ストアの設定に誤りがあるため、${fallback}(${name}):${errorMessage(error)}`);
      return onStoreError === "memory" ? inMemory() : "unavailable";
    }
    if (!config) return inMemory();

    try {
      const hashed = hashClientKey(key, clientKeySecretFromEnv(hashSecretEnv, env));
      const count = await incrementWithExpiry(config, `rl:${name}:${hashed}`, HOUR_MS);
      return count > limit ? "limited" : "ok";
    } catch (error) {
      console.error(`回数制限の共有ストアに接続できなかったため、${fallback}(${name}):${errorMessage(error)}`);
      return onStoreError === "memory" ? inMemory() : "unavailable";
    }
  };
  return Object.assign(check, { reset: () => memory.reset() });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
