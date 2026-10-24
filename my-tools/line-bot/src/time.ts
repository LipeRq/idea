// 日付の表示はすべて日本時間で行う(GitHub Actions も Vercel も UTC で動くため)
const TIME_ZONE = "Asia/Tokyo";

const DATE_PARTS = new Intl.DateTimeFormat("ja-JP", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function parts(date: Date): Record<string, string> {
  return Object.fromEntries(DATE_PARTS.formatToParts(date).map((p) => [p.type, p.value]));
}

/** 10月25日(土) */
export function formatJstDate(date: Date): string {
  const p = parts(date);
  return `${p.month}月${p.day}日(${p.weekday})`;
}

/** 2026年10月25日(土) */
export function formatJstFullDate(date: Date): string {
  const p = parts(date);
  return `${p.year}年${p.month}月${p.day}日(${p.weekday})`;
}

/** 10/25 06:40 */
export function formatJstDateTime(date: Date): string {
  const p = parts(date);
  return `${p.month}/${p.day} ${p.hour}:${p.minute}`;
}
