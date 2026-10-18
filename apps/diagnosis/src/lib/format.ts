export function formatYen(amount: number): string {
  if (amount >= 100_000_000) {
    return `${(amount / 100_000_000).toFixed(1).replace(/\.0$/, "")}億円`;
  }
  if (amount >= 10_000) {
    return `${Math.round(amount / 10_000).toLocaleString("ja-JP")}万円`;
  }
  return `${Math.round(amount).toLocaleString("ja-JP")}円`;
}

export function formatHours(hours: number): string {
  const digits = hours >= 100 ? 0 : 1;
  return `${hours.toLocaleString("ja-JP", { maximumFractionDigits: digits })}時間`;
}
