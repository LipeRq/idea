// 日時の扱い。架空データは日本時間で考えて作り、ファイルには UTC(末尾 Z)の ISO 8601 で書く。
// 基準日を固定しているので、いつ実行しても同じ内容になる(Date.now は使わない)。

export const DAY = 86_400_000;
const JST_OFFSET = 9 * 60 * 60 * 1000;

/** 日本時間の年月日・時分を、UTC のミリ秒にする */
export function jst(y: number, m: number, d: number, h = 0, mi = 0): number {
  return Date.UTC(y, m - 1, d, h, mi) - JST_OFFSET;
}

/** UTC の ISO 8601(例: 2026-10-31T09:15:00.000Z) */
export function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** 日本時間の日付(YYYY-MM-DD) */
export function jstDate(ms: number): string {
  return new Date(ms + JST_OFFSET).toISOString().slice(0, 10);
}

export function jstParts(ms: number) {
  const d = new Date(ms + JST_OFFSET);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours() };
}

/** その日の 0 時(日本時間) */
export function startOfJstDay(ms: number): number {
  return Math.floor((ms + JST_OFFSET) / DAY) * DAY - JST_OFFSET;
}

/** 日本時間の暦日で数えた日数(from の日 → to の日) */
export function daysBetween(fromMs: number, toMs: number): number {
  const startOf = (ms: number) => Math.floor((ms + JST_OFFSET) / DAY);
  return startOf(toMs) - startOf(fromMs);
}
