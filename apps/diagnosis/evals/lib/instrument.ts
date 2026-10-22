import type Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlock } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { priceMessage, type SdkUsageLike, type TokenUsage, ZERO_USAGE } from "./usage";

// アプリの Claude 呼び出し(client.beta.messages.stream → finalMessage)を、コードを変えずに計測する。
// アプリには「本物の Anthropic クライアントの代わりに、同じ形の計測つきクライアント」を渡す。
// 呼び出しの内容(system・messages・effort)、実際に応答したモデル、stop_reason、usage、所要時間を記録する。

export type CallRecord = {
  seq: number;
  label: string;
  requestedModel: string;
  servedModel: string | null;
  stopReason: string | null;
  usage: TokenUsage;
  costUsd: number;
  /** 依頼したモデル以外が応答した(サーバー側フォールバック) */
  fallbackUsed: boolean;
  /** ストリームを開始してから最終メッセージが届くまで(SDKの再試行の待ちを含む) */
  durationMs: number;
  maxTokens: number | null;
  effort: string | null;
  system: unknown;
  messages: unknown;
  content: BetaContentBlock[] | null;
  /** 本文(text ブロックを連結) */
  text: string | null;
  error: string | null;
};

export class CallRecorder {
  readonly calls: CallRecord[] = [];
  add(record: Omit<CallRecord, "seq">): CallRecord {
    const full = { ...record, seq: this.calls.length + 1 };
    this.calls.push(full);
    return full;
  }
  get totalCostUsd(): number {
    return Math.round(this.calls.reduce((s, c) => s + c.costUsd, 0) * 1_000_000) / 1_000_000;
  }
  get totalUsage(): TokenUsage {
    return this.calls.reduce(
      (a, c) => ({
        inputTokens: a.inputTokens + c.usage.inputTokens,
        outputTokens: a.outputTokens + c.usage.outputTokens,
        cacheCreationInputTokens: a.cacheCreationInputTokens + c.usage.cacheCreationInputTokens,
        cacheReadInputTokens: a.cacheReadInputTokens + c.usage.cacheReadInputTokens,
      }),
      ZERO_USAGE,
    );
  }
}

type StreamParams = {
  model: string;
  max_tokens?: number;
  system?: unknown;
  messages?: unknown;
  output_config?: { effort?: string } | null;
};
type StreamLike = { finalMessage(): Promise<unknown> };
type MessageLike = {
  model?: string;
  stop_reason?: string | null;
  content?: BetaContentBlock[];
  usage?: SdkUsageLike | null;
};

export function textOf(content: readonly BetaContentBlock[] | null | undefined): string {
  return (content ?? []).map((b) => (b.type === "text" ? b.text : "")).join("");
}

/**
 * client の beta.messages.stream を計測つきに差し替えた、同じ形のクライアントを返す。
 * classify は、呼び出しに付ける名前(例: map / reduce)。省略すると "call"。
 */
export function instrumentClient(
  client: Anthropic,
  recorder: CallRecorder,
  classify: (params: StreamParams) => string = () => "call",
): Anthropic {
  const messages = client.beta.messages;
  const wrapped = {
    stream(params: StreamParams, options?: unknown): StreamLike {
      const started = performance.now();
      // this を保ったまま呼ぶ(SDK のメソッドは this に依存する)
      const stream = (messages.stream as (p: unknown, o?: unknown) => StreamLike).call(messages, params, options);
      const original = stream.finalMessage.bind(stream);
      let recorded = false;
      const base = (): Omit<CallRecord, "seq" | "servedModel" | "stopReason" | "usage" | "costUsd" | "fallbackUsed" | "content" | "text" | "error"> => ({
        label: classify(params),
        requestedModel: params.model,
        durationMs: Math.round(performance.now() - started),
        maxTokens: params.max_tokens ?? null,
        effort: params.output_config?.effort ?? null,
        system: params.system ?? null,
        messages: params.messages ?? null,
      });
      stream.finalMessage = async () => {
        try {
          const message = (await original()) as MessageLike;
          if (!recorded) {
            recorded = true;
            const priced = priceMessage(params.model, message.model, message.usage);
            recorder.add({
              ...base(),
              servedModel: message.model ?? null,
              stopReason: message.stop_reason ?? null,
              usage: priced.usage,
              costUsd: priced.costUsd,
              fallbackUsed: priced.fallbackUsed,
              content: message.content ?? null,
              text: textOf(message.content),
              error: null,
            });
          }
          return message;
        } catch (e) {
          if (!recorded) {
            recorded = true;
            recorder.add({
              ...base(),
              servedModel: null,
              stopReason: null,
              usage: ZERO_USAGE,
              costUsd: 0,
              fallbackUsed: false,
              content: null,
              text: null,
              error: e instanceof Error ? e.message : String(e),
            });
          }
          throw e;
        }
      };
      return stream;
    },
  };
  return { beta: { messages: wrapped } } as unknown as Anthropic;
}
