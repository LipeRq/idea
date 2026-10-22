import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
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

/**
 * 構造化出力の形式。スキーマだけを渡し、解析は parseStructuredOutput で行う。
 * parse つきの形式(betaZodOutputFormat そのもの)を渡すと、SDKがテキストブロックを1つずつ解析するため、
 * 生成の途中でサーバー側フォールバックが起きた応答では、途中までの文の解析で例外になり、
 * 切り替え後のモデルが書いた正しい出力まで失われる(出力上限・辞退の判定より先に例外になる)。
 */
export function jsonSchemaFormat(schema: z.ZodType) {
  return { type: "json_schema" as const, schema: betaZodOutputFormat(schema).schema };
}

/**
 * 応答の本文から構造化出力(JSON)を取り出し、zod で検証する。取り出せなければ null。
 * 生成の途中でフォールバックが起きた応答の扱いは packages/shared の structured-output.ts(apps/diagnosis・apps/inventory と同じ)。
 */
export { parseStructuredOutput } from "@idea/shared/structured-output";

export class AiOutputError extends Error {}
