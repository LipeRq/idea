/**
 * 同じ引数の依頼は、実行中・完了済みの結果を使い回す。別の引数の依頼は、前の依頼が終わってから始める。
 * Worker は同時に1件しか処理しない(AnalysisController)ため、React の開発モードで effect が2回走ったときや、
 * 利用者が選択肢を素早く切り替えたときに「別の解析を実行中です」で失敗しないようにする。失敗した結果は使い回さない。
 */
export function serialMemo<K, V>(run: (key: K) => Promise<V>): (key: K) => Promise<V> {
  const cache = new Map<K, Promise<V>>();
  let tail: Promise<unknown> = Promise.resolve();
  return (key) => {
    const hit = cache.get(key);
    if (hit) return hit;
    const next = tail.then(() => run(key));
    tail = next.catch(() => undefined);
    cache.set(key, next);
    next.catch(() => cache.delete(key));
    return next;
  };
}
