// 同時実行の数の制限と、1件ごとの時間の上限。

export class CaseTimeoutError extends Error {}

/** 同時に limit 件まで fn を実行する。順番は items の順のまま結果を返す */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

/**
 * 1件の処理全体の時間の上限(ストリームが生きていても止まる)。超えたら CaseTimeoutError で失敗にする。
 * 注意: 打ち切った呼び出し自体は裏で続くことがある(枠を空けて、再試行を止めるだけ)。
 */
export async function withDeadline<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CaseTimeoutError(`${what} が ${Math.round(ms / 1000)} 秒の上限を超えました`)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
