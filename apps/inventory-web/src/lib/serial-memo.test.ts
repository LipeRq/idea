import { describe, expect, it } from "vitest";
import { serialMemo } from "./serial-memo";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("serialMemo", () => {
  it("同じ引数は実行中の依頼を使い回す(開発モードで effect が2回走っても1回だけ実行)", async () => {
    const calls: boolean[] = [];
    const d = deferred<string>();
    const build = serialMemo((key: boolean) => {
      calls.push(key);
      return d.promise;
    });
    const a = build(true);
    const b = build(true);
    expect(a).toBe(b);
    d.resolve("payload");
    await expect(b).resolves.toBe("payload");
    expect(calls).toEqual([true]);
  });

  it("別の引数は前の依頼が終わってから始める(同時に2件走らせない)", async () => {
    const first = deferred<string>();
    const order: string[] = [];
    let running = 0;
    const build = serialMemo(async (key: boolean) => {
      running++;
      expect(running).toBe(1);
      order.push(`start:${key}`);
      const v = key ? await first.promise : "without-source";
      running--;
      return v;
    });
    const a = build(true);
    const b = build(false);
    await Promise.resolve();
    expect(order).toEqual(["start:true"]);
    first.resolve("with-source");
    await expect(a).resolves.toBe("with-source");
    await expect(b).resolves.toBe("without-source");
    expect(order).toEqual(["start:true", "start:false"]);
  });

  it("失敗した結果は使い回さず、次の依頼は失敗の後に続けて実行できる", async () => {
    let attempt = 0;
    const build = serialMemo(async (key: boolean) => {
      attempt++;
      if (attempt === 1) throw new Error("一時的な失敗");
      return `ok:${key}`;
    });
    await expect(build(true)).rejects.toThrow("一時的な失敗");
    await expect(build(true)).resolves.toBe("ok:true");
    expect(attempt).toBe(2);
  });
});
