import { incrementWithExpiry, type UpstashConfig } from "./kv/upstash";

// 日本時間の1日ごとの利用量(AI の呼び出し回数・推定トークンなど)を数える(サーバー専用)。
// 上限の決め方・上限に達したときや数えられないときの扱いは各アプリが決める(ここは数えるだけ)。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
/** 日付が変わった後も前日のキーが残るので、2日で消す */
export const DAILY_KEY_TTL_MS = 2 * 24 * 60 * 60 * 1000;

/** 日本時間の日付(YYYY-MM-DD) */
export function jstDay(now: Date): string {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

export type DailyCounter = {
  /**
   * name の当日分に amount(省略時は1)を足し、足した後の値を返す。
   * config(共有ストア)があればインスタンスをまたいで数え(キーは <name>:<日付>)、なければインスタンス内のメモリで数える
   * (日付が変わったらすべて数え直す)。共有ストアに接続できないときは例外のまま投げる。
   */
  add(config: UpstashConfig | null, name: string, day: string, amount?: number): Promise<number>;
  /** テスト用:メモリで数えた値を消す */
  reset(): void;
};

export function createDailyCounter(): DailyCounter {
  let memory = { day: "", totals: new Map<string, number>() };
  return {
    async add(config, name, day, amount) {
      if (config) return incrementWithExpiry(config, `${name}:${day}`, DAILY_KEY_TTL_MS, amount);
      if (memory.day !== day) memory = { day, totals: new Map() };
      const total = (memory.totals.get(name) ?? 0) + (amount ?? 1);
      memory.totals.set(name, total);
      return total;
    },
    reset() {
      memory = { day: "", totals: new Map() };
    },
  };
}
