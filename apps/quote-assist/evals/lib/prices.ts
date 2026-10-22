import { MODEL, PRICE_PER_MTOK } from "@/lib/ai/client";

// 費用の計算に使う料金表は、アプリ本体(src/lib/ai/client.ts の PRICE_PER_MTOK)と同じものを使う。
// 評価の費用と、画面に出る「概算費用」が食い違わないようにするため。料金が変わったら、アプリ側の表だけを直す。
// (出典: claude-api スキル shared/models.md。Opus 5.5 は 入力$4・出力$20・キャッシュ書き込み$5・キャッシュ読み取り$0.2 / 100万トークン)
export type ModelPrice = { input: number; output: number; cacheWrite: number; cacheRead: number };

export const PRICES_USD_PER_MTOK: Record<string, ModelPrice> = PRICE_PER_MTOK;

export const DEFAULT_MODEL = MODEL;

/** 為替(円/ドル)。環境変数 USD_JPY で変えられる(アプリ本体と同じ) */
export function usdJpy(): number {
  return Number(process.env.USD_JPY) || 150;
}

/** 料金表にないモデルは Opus 5.5 の料金で概算し、assumed を true にする */
export function priceFor(model: string | null | undefined): { price: ModelPrice; assumed: boolean } {
  const known = model ? PRICES_USD_PER_MTOK[model] : undefined;
  return { price: known ?? PRICES_USD_PER_MTOK[DEFAULT_MODEL], assumed: !known };
}
