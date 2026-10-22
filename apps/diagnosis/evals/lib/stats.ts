// 小さな集計の道具。件数が少ない評価なので、割合には必ず信頼区間(Wilson, 95%)を添える。

export type Rate = { k: number; n: number; rate: number | null; low: number | null; high: number | null };

export function rateOf(k: number, n: number): Rate {
  if (n === 0) return { k, n, rate: null, low: null, high: null };
  const z = 1.96;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { k, n, rate: p, low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

export function fmtRate(r: Rate): string {
  if (r.rate === null) return "—(対象なし)";
  return `${(r.rate * 100).toFixed(0)}%(${r.k}/${r.n}、95%区間 ${((r.low ?? 0) * 100).toFixed(0)}〜${((r.high ?? 0) * 100).toFixed(0)}%)`;
}

export function mean(xs: number[]): number | null {
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function percentile(xs: number[], p: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx];
}

export const median = (xs: number[]) => percentile(xs, 50);

export const usd = (v: number | null, digits = 3) => (v === null ? "—" : `$${v.toFixed(digits)}`);
export const sec = (ms: number | null) => (ms === null ? "—" : `${(ms / 1000).toFixed(1)}秒`);
