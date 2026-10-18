import type { Usage } from "../domain/inquiry";

export const MODEL = "claude-opus-5-5";

// 100万トークンあたりの価格(米ドル、2026年10月時点の公表価格)。キャッシュ書き込みは5分TTL
export const PRICE_PER_MTOK: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
};

export function hasAnthropicCredentials(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

type SdkUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

export function usageOf(u: SdkUsage | null | undefined): Usage {
  return {
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    cacheCreationInputTokens: u?.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: u?.cache_read_input_tokens ?? 0,
  };
}

/** 概算費用(米ドル)。価格表にないモデル(フォールバック先など)は Opus 5.5 の価格で概算する */
export function estimateCostUsd(usage: Usage, model: string | null): number {
  const p = PRICE_PER_MTOK[model ?? MODEL] ?? PRICE_PER_MTOK[MODEL];
  const usd =
    (usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      usage.cacheCreationInputTokens * p.cacheWrite +
      usage.cacheReadInputTokens * p.cacheRead) /
    1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

export function usdToJpy(usd: number): number {
  const rate = Number(process.env.USD_JPY) || 150;
  return usd * rate;
}

/** 山かっこを全角にして、メール本文などからタグを閉じて指示を差し込めないようにする */
export function escapeTags(text: string): string {
  return text.replaceAll("<", "＜").replaceAll(">", "＞");
}

export class AiOutputError extends Error {}
