import { createDailyCounter, jstDay } from "@idea/shared/daily-counter";
import { kvConfigFromEnv } from "./kv";

// Claude API の1日あたりの呼び出し上限(サイト全体)。AI_DAILY_LIMIT で設定する。
// 呼び出す前に1回数え、上限を超えたら呼ばずに標準レポートにする(失敗した呼び出しも数える)。
// 日付は日本時間で区切る。Upstash Redis があればインスタンスをまたいで数え、なければインスタンス内のメモリで数える
// (数え方は packages/shared の daily-counter.ts)。

const counter = createDailyCounter();

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
    count = await counter.add(kvConfigFromEnv(env), "ai-daily", day);
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
  counter.reset();
}
