// Claude API の料金表(米ドル / 100万トークン)。評価の費用はすべてここから計算する。
// 出典: claude-api スキル shared/models.md(2026年10月時点)。料金が変わったら、この表だけを直す。
// - cacheWrite: 5分TTLのキャッシュ書き込み(入力の1.25倍)
// - cacheRead: キャッシュ読み取り(Opus 5.5 / Sonnet 5.5 は $0.20)
// このアプリの評価で使うのは、本番と同じ claude-opus-5-5(文章の生成と、既定の採点モデル)だけ。(apps/diagnosis/evals/lib と同じ内容。料金を変えるときは3つのアプリの評価の prices.ts を同じに保つ)
export type ModelPrice = { input: number; output: number; cacheWrite: number; cacheRead: number };

export const PRICES_USD_PER_MTOK: Record<string, ModelPrice> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  // --judge-model で採点モデルを変えるとき用
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
};

export const DEFAULT_MODEL = "claude-opus-5-5";

/** 為替(円/ドル)。環境変数 USD_JPY で変えられる。円は目安の表示だけに使う */
export function usdJpy(): number {
  return Number(process.env.USD_JPY) || 150;
}

/** 料金表にないモデルは Opus 5.5 の料金で概算し、assumed を true にする(結果に注記する) */
export function priceFor(model: string | null | undefined): { price: ModelPrice; assumed: boolean } {
  const known = model ? PRICES_USD_PER_MTOK[model] : undefined;
  return { price: known ?? PRICES_USD_PER_MTOK[DEFAULT_MODEL], assumed: !known };
}
