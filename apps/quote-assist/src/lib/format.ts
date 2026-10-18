export function formatYen(amount: number): string {
  return `${Math.round(amount).toLocaleString("ja-JP")}円`;
}

export function formatNumber(value: number, maxDigits = 1): string {
  return value.toLocaleString("ja-JP", { maximumFractionDigits: maxDigits });
}

export function formatHours(hours: number): string {
  return `${formatNumber(hours, 2)}時間`;
}

export function formatPercent(rate: number, digits = 0): string {
  return `${(rate * 100).toFixed(digits)}%`;
}

/** 2026-10-18 → 2026年10月18日。日時(ISO形式)は日本時間の日付にする */
export function formatDate(iso: string): string {
  const date =
    iso.length > 10 ? new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date(iso)) : iso;
  const [y, m, d] = date.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}

/** 秒・ミリ秒を読みやすく(1.2秒、850ミリ秒) */
export function formatDuration(ms: number): string {
  if (ms >= 1000) return `${formatNumber(ms / 1000, 1)}秒`;
  return `${Math.round(ms)}ミリ秒`;
}

export function formatUsd(usd: number): string {
  return `$${usd.toFixed(usd >= 1 ? 2 : 4)}`;
}
