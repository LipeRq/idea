// ファジング用の小さな道具: 決定的な乱数(シードで再現できる)と、バイト列を壊す操作。
import { unzipSync, zipSync } from "fflate";

/** mulberry32。同じシードなら同じ列になる */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (max: number) => Math.floor(next() * max),
    pick: <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)],
  };
}

export type Rng = ReturnType<typeof rng>;

const EXTREMES = [0, 1, 0x7f, 0x80, 0xff, 0x7fff, 0x8000, 0xffff, 0x7fffffff, 0x80000000, 0xfffffffe, 0xffffffff];

/** バイト列を1種類の方法で壊す。どう壊したかの説明も返す(失敗したときの再現用) */
export function mutate(data: Uint8Array, r: Rng, region?: { start: number; end: number }): { bytes: Uint8Array; how: string } {
  const start = region?.start ?? 0;
  const end = Math.max(start + 1, region?.end ?? data.length);
  const at = () => start + r.int(end - start);
  const out = Uint8Array.from(data);
  switch (r.int(6)) {
    case 0: {
      const n = 1 + r.int(32);
      for (let i = 0; i < n; i++) out[at()] ^= 1 + r.int(255);
      return { bytes: out, how: `${n} バイトを反転` };
    }
    case 1: {
      const len = at();
      return { bytes: data.slice(0, len), how: `${len} バイトで切り詰め` };
    }
    case 2: {
      const p = at();
      const len = 1 + r.int(512);
      out.fill(0, p, Math.min(out.length, p + len));
      return { bytes: out, how: `${p} から ${len} バイトを 0 に` };
    }
    case 3: {
      const p = at();
      const len = 1 + r.int(256);
      const q = at();
      const chunk = data.slice(p, p + len);
      const grown = new Uint8Array(data.length + chunk.length);
      grown.set(data.subarray(0, q));
      grown.set(chunk, q);
      grown.set(data.subarray(q), q + chunk.length);
      return { bytes: grown, how: `${p} からの ${len} バイトを ${q} に挿入` };
    }
    case 4: {
      // 長さ・位置のフィールドを極端な値にする
      const n = 1 + r.int(4);
      for (let i = 0; i < n; i++) {
        const p = Math.min(at(), out.length - 4);
        if (p < 0) break;
        const v = r.pick(EXTREMES);
        new DataView(out.buffer).setUint32(p, v >>> 0, true);
      }
      return { bytes: out, how: `${n} か所の 4 バイトを極端な値に` };
    }
    default: {
      const n = 1 + r.int(8);
      for (let i = 0; i < n; i++) out[at()] = r.int(256);
      return { bytes: out, how: `${n} バイトを乱数に` };
    }
  }
}

/** zip の中身をそのままに、非圧縮(stored)で詰め直す(破損が XML や vbaProject.bin に直接届くように) */
export function restoreZip(zip: Uint8Array, replace: Record<string, Uint8Array> = {}): Uint8Array {
  const files = { ...unzipSync(zip), ...replace };
  return zipSync(files, { level: 0 });
}

/** zip 内のファイルの位置(非圧縮で詰めたときのデータの範囲) */
export function storedRange(zip: Uint8Array, name: string): { start: number; end: number } {
  const target = new TextEncoder().encode(name);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  for (let p = 0; p + 30 < zip.length; p++) {
    if (view.getUint32(p, true) !== 0x04034b50) continue;
    const nameLength = view.getUint16(p + 26, true);
    const extra = view.getUint16(p + 28, true);
    const size = view.getUint32(p + 18, true);
    const n = zip.subarray(p + 30, p + 30 + nameLength);
    if (n.length === target.length && n.every((b, i) => b === target[i])) {
      const start = p + 30 + nameLength + extra;
      return { start, end: start + size };
    }
  }
  throw new Error(`${name} が見つかりません`);
}
