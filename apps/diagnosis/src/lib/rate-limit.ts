// サーバーのインスタンス内だけで数える簡易的な回数制限。
// 本番で複数インスタンスになる場合は、Redisなどの共有ストアに置き換える。

const WINDOW_MS = 60 * 60 * 1000;
// 期限切れのキーを消す間隔。消さないとアクセス元が増えるたびにメモリが増え続ける
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

/** 上限を超えていれば true。超えていなければ回数に数えて false */
export type RateLimiter = (key: string, now?: number) => boolean;

/** 環境変数の値が正の整数ならそれを、そうでなければ既定値を返す */
export function limitFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * 同じキー(送信元)から1時間に何回まで受け付けるか。
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

/** 診断(AIを呼ぶので最も厳しく) */
export const isDiagnoseRateLimited = createRateLimiter("RATE_LIMIT_DIAGNOSE_PER_HOUR", 5);
/** PDFレポートの作成 */
export const isReportRateLimited = createRateLimiter("RATE_LIMIT_REPORT_PER_HOUR", 30);
/** 無料相談の申し込み */
export const isLeadRateLimited = createRateLimiter("RATE_LIMIT_LEAD_PER_HOUR", 5);
