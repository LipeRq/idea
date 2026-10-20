import { incrementWithExpiry, upstashConfigFromEnv } from "./kv/upstash";

// Claude API の1日あたりの呼び出し上限(サイト全体)。AI_DAILY_LIMIT で設定する。
// 呼び出す前に1回数え、上限を超えたら呼ばずに標準レポートにする(失敗した呼び出しも数える)。
// 日付は日本時間で区切る。Upstash Redis があればインスタンスをまたいで数え、なければインスタンス内のメモリで数える。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
// 日付が変わった後も前日のキーが残るので、2日で消す
const KEY_TTL_MS = 2 * 24 * 60 * 60 * 1000;

let memoryCount: { day: string; count: number } = { day: "", count: 0 };

export type AiDailyLimit =
  | { kind: "unlimited" }
  | { kind: "limited"; limit: number };

/**
 * 未設定なら上限なし。0以上の整数ならその回数(0ならAIを使わない)。
 * 数字として読めない値は、費用を抑える側に倒してAIを使わない(ログに設定の誤りを出す)。
 */
export function aiDailyLimit(env: NodeJS.ProcessEnv = process.env): AiDailyLimit {
  const raw = env.AI_DAILY_LIMIT?.trim();
  if (!raw) return { kind: "unlimited" };
  const value = Number(raw);
  if (Number.isInteger(value) && value >= 0) return { kind: "limited", limit: value };
  console.error(
    `AI_DAILY_LIMIT の値(${raw})を読み取れないため、AIを使わずに標準レポートで返します。0以上の整数を設定してください`,
  );
  return { kind: "limited", limit: 0 };
}

/** 日本時間の日付(YYYY-MM-DD) */
export function jstDay(now: Date): string {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * AIを1回呼んでよいかを確かめ、よければ回数に数える。上限に達していれば false。
 * 共有ストアに接続できないときは、費用が膨らまないよう false(標準レポート)にする。
 */
export async function reserveAiCall(
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const setting = aiDailyLimit(env);
  if (setting.kind === "unlimited") return true;
  if (setting.limit === 0) return false;

  const day = jstDay(now);
  let count: number;
  try {
    const config = upstashConfigFromEnv(env);
    if (config) {
      count = await incrementWithExpiry(config, `ai-daily:${day}`, KEY_TTL_MS);
    } else {
      if (memoryCount.day !== day) memoryCount = { day, count: 0 };
      count = ++memoryCount.count;
    }
  } catch (error) {
    console.error(
      "AIの呼び出し回数を数えられなかったため、標準レポートで返します",
      error instanceof Error ? error.message : error,
    );
    return false;
  }

  if (count === setting.limit + 1) {
    console.warn(
      `本日(${day})のAIの呼び出しが上限(${setting.limit}回)に達しました。日付が変わるまで標準レポートで返します`,
    );
  }
  return count <= setting.limit;
}

/** テスト用:メモリで数えた回数を消す */
export function resetAiQuotaForTest(): void {
  memoryCount = { day: "", count: 0 };
}
