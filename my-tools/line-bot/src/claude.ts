// Claude の呼び出し(構造化出力)。apps/inventory の src/doc/ai.ts と同じ形にしている。
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { z } from "zod";
import { parseStructuredOutput } from "../../../packages/shared/src/structured-output";
import { MODEL } from "./model";

export type Effort = "low" | "medium" | "high";

export interface StructuredRequest<S extends z.ZodType> {
  system: string;
  /** テキストだけならそのまま。写真を付けるときは content のブロックの配列 */
  user: string | BetaContentBlockParam[];
  schema: S;
  maxTokens: number;
  effort: Effort;
}

/** 構造化出力を返す LLM 呼び出し。テストではモックに差し替える */
export interface StructuredClient {
  generate<S extends z.ZodType>(req: StructuredRequest<S>): Promise<z.infer<S>>;
}

export class AiGenerationError extends Error {}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ClaudeClientOptions {
  /** 1回の依頼(SDK の再試行を含む)の時間の上限(ミリ秒) */
  requestTimeoutMs?: number;
  /** 使ったトークン数を受け取る(費用の確認用。ログに出す) */
  onUsage?: (usage: TokenUsage) => void;
}

export const DEFAULT_REQUEST_TIMEOUT_MS = 90_000;

export function hasAnthropicCredentials(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);
}

/**
 * 構造化出力の形式。スキーマだけを渡し、解析は parseStructuredOutput で行う
 * (parse つきの形式だと、生成の途中でフォールバックが起きた応答で例外になる。packages/shared の structured-output.ts を参照)。
 */
function jsonSchemaFormat(schema: z.ZodType) {
  return { type: "json_schema" as const, schema: betaZodOutputFormat(schema).schema };
}

export function createClaudeClient(anthropic: Anthropic = new Anthropic(), options: ClaudeClientOptions = {}): StructuredClient {
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  return {
    async generate<S extends z.ZodType>(req: StructuredRequest<S>): Promise<z.infer<S>> {
      const signal = AbortSignal.timeout(requestTimeoutMs);
      const stream = anthropic.beta.messages.stream(
        {
          model: MODEL,
          max_tokens: req.maxTokens,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: req.effort, format: jsonSchemaFormat(req.schema) },
          system: req.system,
          messages: [{ role: "user", content: req.user }],
        },
        { signal },
      );
      let message: Awaited<ReturnType<typeof stream.finalMessage>>;
      try {
        message = await stream.finalMessage();
      } catch (e) {
        if (signal.aborted) {
          throw new AiGenerationError(`AIの応答が時間内(${Math.round(requestTimeoutMs / 1000)}秒)に終わりませんでした`);
        }
        throw e;
      }
      options.onUsage?.({ inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens });
      // stop_reason を先に見る(辞退・出力上限で途中切れのときは、途中までの文を使わない)
      if (message.stop_reason === "refusal") throw new AiGenerationError("AIが生成を辞退しました");
      if (message.stop_reason === "max_tokens") throw new AiGenerationError("AIの出力が上限に達しました");
      const output = parseStructuredOutput(message.content, req.schema);
      if (output === null) throw new AiGenerationError("AIの出力を解析できませんでした");
      return output as z.infer<S>;
    },
  };
}

/** 例外を、LINE やログに出せる短い理由にする(メモの内容は含めない) */
export function describeAiError(e: unknown): string {
  if (e instanceof AiGenerationError) return e.message;
  if (e instanceof Anthropic.AuthenticationError) return "Claude API のキーが正しくありません";
  if (e instanceof Anthropic.RateLimitError) return "Claude API の利用上限に達しました";
  if (e instanceof Anthropic.APIConnectionError) return "Claude API に接続できませんでした";
  if (e instanceof Anthropic.APIError) return `Claude API のエラー(${e.status ?? "不明"})`;
  return "AIの呼び出しに失敗しました";
}

/**
 * データの中の、区切りのタグに見える文字列を無害化する(< を &lt; にする)。
 * RSS の記事は第三者の文章なので、<article> などの区切りを壊されないようにする。
 */
export function defangTags(text: string, tags: readonly string[]): string {
  const pattern = new RegExp(`<(\\s*\\/?\\s*)(${tags.join("|")})(?![\\p{L}\\p{N}_-])`, "giu");
  return text.replace(pattern, "&lt;$1$2");
}

/** タグの属性値に入れる文字列(引用符・山括弧・改行で区切りを壊されないように) */
export function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\r\n\t]+/g, " ");
}
