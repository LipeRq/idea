// サーバーのインスタンス内だけで数える簡易的な回数制限。
// 本番で複数インスタンスになる場合は、Redisなどの共有ストアに置き換える。

const WINDOW_MS = 60 * 60 * 1000;
const MAX_REQUESTS = 5;
// 期限切れのキーを消す間隔。消さないとアクセス元が増えるたびにメモリが増え続ける
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

const hits = new Map<string, number[]>();
let lastSweep = 0;

export function isRateLimited(key: string, now = Date.now()): boolean {
  if (now - lastSweep >= SWEEP_INTERVAL_MS) {
    for (const [k, times] of hits) {
      if (now - times[times.length - 1] >= WINDOW_MS) hits.delete(k);
    }
    lastSweep = now;
  }

  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  return false;
}
