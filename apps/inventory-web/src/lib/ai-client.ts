// AI 版の利用可否の確認と、同意後の送信(画面側)。
// 通信を書ける場所を限定するため、fetch を使うのはこのファイルと engine-loader.ts・samples.ts だけ。
// - 利用可否(GET)はファイル由来の情報を一切含まないので、ページ表示時に取得してよい(使えない環境ではボタンを出さない)
// - 送信(POST)は利用者が同意画面で同意したときだけ。本文は同意画面で示した文字列そのもの
import "./zod-setup";
import { z } from "zod";
import { AiDocumentJsonSchema } from "./ai-json-schema";
import type { AiDocumentJson } from "./ai-json";
import { NdjsonParser } from "./ndjson";

export const AI_ENDPOINT = "/api/ai-document";

const AiStatusSchema = z.object({
  available: z.boolean(),
  mode: z.enum(["off", "claude", "mock"]),
  requiresAccessCode: z.boolean(),
  maxInputTokens: z.number().int().nonnegative(),
  maxBatches: z.number().int().nonnegative(),
  maxBodyBytes: z.number().int().nonnegative(),
  consentVersion: z.string(),
});
export type AiStatus = z.infer<typeof AiStatusSchema>;

/** 利用可否を取得する。取得できない・形が違うときは null(AI 版のボタンを出さない) */
export async function fetchAiStatus(signal?: AbortSignal): Promise<AiStatus | null> {
  try {
    const res = await fetch(AI_ENDPOINT, { method: "GET", cache: "no-store", credentials: "same-origin", signal });
    if (!res.ok) return null;
    const parsed = AiStatusSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type AiErrorCode =
  | "disabled"
  | "forbidden"
  | "rate_limited"
  | "unsupported_media_type"
  | "too_large"
  | "invalid"
  | "consent_outdated"
  | "daily_limit"
  | "unavailable"
  | "ai_error"
  | "network"
  | "bad_response"
  | "internal";

export class AiRequestError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

const ErrorBodySchema = z.object({ error: z.string().max(500), code: z.string().max(50).optional() });

const KNOWN_CODES = new Set<string>([
  "disabled",
  "forbidden",
  "rate_limited",
  "unsupported_media_type",
  "too_large",
  "invalid",
  "consent_outdated",
  "daily_limit",
  "unavailable",
  "internal",
]);

/** JSON でない応答(プラットフォームが返す 413 や 504 の HTML など)の文言 */
export function messageForStatus(status: number): { code: AiErrorCode; message: string } {
  if (status === 413) return { code: "too_large", message: "送信内容が大きすぎるため受け付けられませんでした。標準の仕様書をお使いいただくか、ご相談ください。" };
  if (status === 429) return { code: "rate_limited", message: "利用回数の上限に達しました。時間をおいてお試しください。" };
  if (status === 502 || status === 503 || status === 504) {
    return { code: "unavailable", message: "サーバーが時間内に応答しませんでした。時間をおいてお試しください。" };
  }
  return { code: "internal", message: `サーバーでエラーが起きました(HTTP ${status})。時間をおいてお試しください。` };
}

async function errorFromResponse(res: Response): Promise<AiRequestError> {
  const text = await res.text().catch(() => "");
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const parsed = ErrorBodySchema.safeParse(body);
  if (parsed.success) {
    const code = parsed.data.code && KNOWN_CODES.has(parsed.data.code) ? (parsed.data.code as AiErrorCode) : messageForStatus(res.status).code;
    if (code === "consent_outdated") {
      return new AiRequestError(code, "画面が古いため送信できませんでした。ページを再読み込みしてから、もう一度お試しください。", res.status);
    }
    return new AiRequestError(code, parsed.data.error, res.status);
  }
  const fallback = messageForStatus(res.status);
  return new AiRequestError(fallback.code, fallback.message, res.status);
}

const EventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("accepted"), batches: z.number().int().nonnegative() }),
  z.object({ type: z.literal("progress"), message: z.string().max(200) }),
  z.object({ type: z.literal("heartbeat") }),
  z.object({ type: z.literal("done"), ai: z.unknown() }),
  z.object({ type: z.literal("error"), message: z.string().max(500) }),
]);

export interface AiRequestOptions {
  body: string;
  accessCode?: string;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

/** 同意した送信内容を送り、AI の文章(検証済み)を受け取る */
export async function requestAiDocument({ body, accessCode, signal, onProgress }: AiRequestOptions): Promise<AiDocumentJson> {
  let res: Response;
  try {
    res = await fetch(AI_ENDPOINT, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(accessCode ? { "X-Access-Code": encodeURIComponent(accessCode) } : {}),
      },
      body,
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new AiRequestError("network", "サーバーに接続できませんでした。ネットワークの接続を確認してください。");
  }
  if (!res.ok) throw await errorFromResponse(res);
  if (!(res.headers.get("content-type") ?? "").includes("application/x-ndjson") || !res.body) {
    throw new AiRequestError("bad_response", "サーバーの応答を読み取れませんでした。時間をおいてお試しください。", res.status);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  const parser = new NdjsonParser();
  const handle = (value: unknown): AiDocumentJson | undefined => {
    const event = EventSchema.safeParse(value);
    if (!event.success) return undefined;
    switch (event.data.type) {
      case "progress":
        onProgress?.(event.data.message);
        return undefined;
      case "error":
        throw new AiRequestError("ai_error", event.data.message);
      case "done": {
        const ai = AiDocumentJsonSchema.safeParse(event.data.ai);
        if (!ai.success) throw new AiRequestError("bad_response", "AI の応答を読み取れませんでした。時間をおいてお試しください。");
        return ai.data;
      }
      default:
        return undefined;
    }
  };
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<string>;
      try {
        chunk = await reader.read();
      } catch (e) {
        if (signal?.aborted) throw e;
        throw new AiRequestError("network", "通信が途中で切れました。時間をおいてお試しください。");
      }
      const items = chunk.done ? parser.end() : parser.push(chunk.value);
      for (const item of items) {
        if (!item.ok) continue;
        const done = handle(item.value);
        if (done) return done;
      }
      if (chunk.done) break;
    }
  } finally {
    reader.releaseLock();
  }
  throw new AiRequestError("network", "通信が途中で切れました。時間をおいてお試しください。");
}
