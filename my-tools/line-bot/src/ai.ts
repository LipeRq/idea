// DeepSeek API(OpenAI 互換の chat completions)の呼び出し。JSON モードで答えさせ、zod で検証する。
// GitHub Actions(Node.js)と Cloudflare Workers の両方で動くよう、SDK を使わず fetch で呼ぶ。
import { z } from "zod";

/** 使うモデル(DeepSeek の Flash。写真も読める) */
export const MODEL = "deepseek-flash";
const ENDPOINT = "https://api.deepseek.com/chat/completions";

export type UserContent = string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[];

export interface StructuredRequest<S extends z.ZodType> {
  system: string;
  /** テキストだけならそのまま。写真を付けるときは content の配列 */
  user: UserContent;
  schema: S;
  maxTokens: number;
}

/** JSON を返す AI の呼び出し。テストでは偽物に差し替える */
export interface StructuredClient {
  generate<S extends z.ZodType>(req: StructuredRequest<S>): Promise<z.infer<S>>;
}

export class AiGenerationError extends Error {}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface AiClientOptions {
  fetch?: FetchLike;
  /** 1回の依頼の時間の上限(ミリ秒) */
  requestTimeoutMs?: number;
  /** 使ったトークン数を受け取る(費用の確認用。ログに出す) */
  onUsage?: (usage: TokenUsage) => void;
}

export const DEFAULT_REQUEST_TIMEOUT_MS = 90_000;
/** JSON が空・壊れていたときに、もう一度だけ頼む */
const ATTEMPTS = 2;

/** JSON モードでは、出力の形をプロンプトで伝える(JSON Schema をそのまま見せる) */
export function jsonInstruction(schema: z.ZodType): string {
  return `出力は JSON だけにしてください。次の JSON Schema に合う形にしてください。

\`\`\`json
${JSON.stringify(z.toJSONSchema(schema), null, 2)}
\`\`\``;
}

function statusMessage(status: number): string {
  if (status === 401) return "DeepSeek API のキーが正しくありません";
  if (status === 402) return "DeepSeek API の残高が足りません";
  if (status === 429) return "DeepSeek API が混み合っています";
  if (status >= 500) return "DeepSeek API が応答しませんでした";
  return `DeepSeek API のエラー(${status})`;
}

interface ChatResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function createDeepSeekClient(apiKey: string, options: AiClientOptions = {}): StructuredClient {
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  async function call(body: unknown): Promise<ChatResponse> {
    let res: Response;
    try {
      res = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      throw new AiGenerationError(timedOut ? `AIの応答が時間内(${Math.round(timeoutMs / 1000)}秒)に終わりませんでした` : "DeepSeek API に接続できませんでした");
    }
    if (!res.ok) throw new AiGenerationError(statusMessage(res.status));
    return (await res.json()) as ChatResponse;
  }

  return {
    async generate<S extends z.ZodType>(req: StructuredRequest<S>): Promise<z.infer<S>> {
      const body = {
        model: MODEL,
        messages: [
          { role: "system", content: `${req.system}\n\n${jsonInstruction(req.schema)}` },
          { role: "user", content: req.user },
        ],
        response_format: { type: "json_object" },
        // 考える過程は使わない(速く、安くするため)
        thinking: { type: "disabled" },
        max_tokens: req.maxTokens,
        stream: false,
      };
      for (let attempt = 1; ; attempt++) {
        const data = await call(body);
        options.onUsage?.({ inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 });
        const choice = data.choices?.[0];
        if (choice?.finish_reason === "length") throw new AiGenerationError("AIの出力が上限に達しました");
        if (choice?.finish_reason === "content_filter") throw new AiGenerationError("AIが生成を辞退しました");
        let json: unknown = null;
        try {
          json = JSON.parse(choice?.message?.content ?? "");
        } catch {
          // 空・壊れた JSON は、もう一度頼む
        }
        const parsed = req.schema.safeParse(json);
        if (parsed.success) return parsed.data as z.infer<S>;
        if (attempt >= ATTEMPTS) throw new AiGenerationError("AIの出力を解析できませんでした");
      }
    },
  };
}

/** 例外を、LINE やログに出せる短い理由にする(メモの内容は含めない) */
export function describeAiError(e: unknown): string {
  return e instanceof AiGenerationError ? e.message : "AIの呼び出しに失敗しました";
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
