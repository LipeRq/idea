// 種を固定した乱数。合成データを毎回同じ内容で作るために使う(Math.random は使わない)。

export type Random = ReturnType<typeof createRandom>;

export function createRandom(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const between = (min: number, max: number) => min + (max - min) * next();
  const int = (min: number, max: number) => Math.floor(between(min, max + 1));
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)];
  const weighted = <T>(items: readonly (readonly [T, number])[]): T => {
    const total = items.reduce((s, [, w]) => s + w, 0);
    let r = next() * total;
    for (const [item, w] of items) {
      r -= w;
      if (r < 0) return item;
    }
    return items[items.length - 1][0];
  };
  const normal = (mean = 0, sd = 1) => {
    const u = Math.max(next(), 1e-12);
    const v = next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const chance = (p: number) => next() < p;
  const sample = <T>(items: readonly T[], n: number): T[] => {
    const copy = [...items];
    const out: T[] = [];
    while (out.length < n && copy.length > 0) out.push(copy.splice(Math.floor(next() * copy.length), 1)[0]);
    return out;
  };
  return { next, between, int, pick, weighted, normal, chance, sample };
}

export function roundTo(value: number, step: number): number {
  return Math.round(Math.round(value / step) * step * 1000) / 1000;
}
