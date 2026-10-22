import { priceFor } from "./prices";

// トークン数と費用。数は API の応答の usage だけから作る(文字数からの推定はしない)。

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
};

export const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
  };
}

export function totalTokens(u: TokenUsage): number {
  return u.inputTokens + u.outputTokens + u.cacheCreationInputTokens + u.cacheReadInputTokens;
}

/** 1モデル分の費用(米ドル) */
export function costUsd(model: string | null | undefined, u: TokenUsage): number {
  const { price: p } = priceFor(model);
  const usd =
    (u.inputTokens * p.input + u.outputTokens * p.output + u.cacheCreationInputTokens * p.cacheWrite + u.cacheReadInputTokens * p.cacheRead) /
    1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

type SdkCounts = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};
export type SdkUsageLike = SdkCounts & {
  iterations?: ReadonlyArray<SdkCounts & { type?: string; model?: string }> | null;
};

const fromSdk = (u: SdkCounts | null | undefined): TokenUsage => ({
  inputTokens: u?.input_tokens ?? 0,
  outputTokens: u?.output_tokens ?? 0,
  cacheCreationInputTokens: u?.cache_creation_input_tokens ?? 0,
  cacheReadInputTokens: u?.cache_read_input_tokens ?? 0,
});

/**
 * 応答1件のトークン数と費用。サーバー側フォールバックが起きた応答は usage.iterations に
 * 試行ごとの内訳(fallback_message にはモデル名)が入るので、あれば内訳を足し合わせ、試行ごとのモデルの料金で計算する。
 * 内訳がなければ、応答の usage をそのまま、応答の model の料金で計算する。
 * fallbackUsed は、依頼したモデル以外が応答した(または内訳に fallback_message がある)こと。
 */
export function priceMessage(
  requestedModel: string,
  servedModel: string | null | undefined,
  usage: SdkUsageLike | null | undefined,
): { usage: TokenUsage; costUsd: number; fallbackUsed: boolean } {
  const iterations = usage?.iterations ?? [];
  const fallbackUsed = (servedModel != null && servedModel !== requestedModel) || iterations.some((i) => i.type === "fallback_message");
  if (iterations.length > 0) {
    let total = ZERO_USAGE;
    let cost = 0;
    for (const it of iterations) {
      const u = fromSdk(it);
      total = addUsage(total, u);
      // モデル名のない試行(type: message)は、最初に依頼したモデルでの試行
      cost += costUsd(it.model ?? requestedModel, u);
    }
    return { usage: total, costUsd: Math.round(cost * 1_000_000) / 1_000_000, fallbackUsed };
  }
  const u = fromSdk(usage);
  return { usage: u, costUsd: costUsd(servedModel ?? requestedModel, u), fallbackUsed };
}
