// 日付は日本時間の暦日(YYYY-MM-DD)で扱う。営業日は土日を除いた日(祝日はMVPでは考慮しない)。

export function todayJst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(now);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function isWeekend(iso: string): boolean {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/** from の翌日から to までの営業日数(to が from より前なら負の数) */
export function businessDaysBetween(from: string, to: string): number {
  if (to === from) return 0;
  if (to < from) return -businessDaysBetween(to, from);
  let count = 0;
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) {
    if (!isWeekend(d)) count++;
  }
  return count;
}

/** from から営業日で days 日後の日付 */
export function addBusinessDays(from: string, days: number): string {
  let d = from;
  for (let n = 0; n < days; ) {
    d = addDays(d, 1);
    if (!isWeekend(d)) n++;
  }
  return d;
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 2026-11-27 → 2026年11月27日(金) */
export function formatJpDate(iso: string, withWeekday = false): string {
  const [y, m, d] = iso.split("-").map(Number);
  const w = WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];
  return `${y}年${m}月${d}日${withWeekday ? `(${w})` : ""}`;
}

/**
 * 文中の日付を YYYY-MM-DD にする。「2026年11月27日」「11月27日」「11/27」に対応し、
 * 年がなければ base 以降で最も近い日付にする。見つからなければ null。
 */
export function findDateInText(text: string, base: string): string | null {
  const full = text.match(/(\d{4})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})\s*日?/);
  if (full) return toIso(Number(full[1]), Number(full[2]), Number(full[3]));
  const short = text.match(/(\d{1,2})\s*(?:月|\/)\s*(\d{1,2})\s*日?/);
  if (!short) return null;
  const [y] = base.split("-").map(Number);
  const candidate = toIso(y, Number(short[1]), Number(short[2]));
  if (!candidate) return null;
  return candidate >= base ? candidate : toIso(y + 1, Number(short[1]), Number(short[2]));
}

function toIso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso ? iso : null;
}
