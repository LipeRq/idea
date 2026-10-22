import Anthropic from "@anthropic-ai/sdk";

// ログは処理の追跡に必要な最小限だけを出す。
// メール本文・図面の内容・抽出値・顧客名・金額・APIキー・CRMのトークンは渡さないこと(型で数値・真偽値・短いidに限定)。

type Safe = number | boolean | null | `${string}`;

const MAX_STRING = 64;

export function logEvent(event: string, fields: Record<string, Safe> = {}): void {
  const safe = Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, MAX_STRING) : v]),
  );
  console.info(JSON.stringify({ at: new Date().toISOString(), event, ...safe }));
}

/** 例外は種類とHTTPステータスだけを記録する(メッセージに入力内容が含まれることがあるため) */
export function logError(event: string, error: unknown, fields: Record<string, Safe> = {}): void {
  const status = (error as { status?: unknown } | null)?.status;
  console.error(
    JSON.stringify({
      at: new Date().toISOString(),
      event,
      errorType: errorTypeOf(error),
      status: typeof status === "number" ? status : null,
      ...fields,
    }),
  );
}

// 本番ビルドではクラス名が短く潰れる(例:"s")ため、constructor.name は使わない。
// Claude SDK の例外はクラスで照合し、それ以外は潰れない名前(組み込みの TypeError・AbortError など)だけを使う。
// 子クラスを先に並べる(APIConnectionTimeoutError は APIConnectionError の子、どれも APIError の子)
const SDK_ERRORS = [
  "APIUserAbortError",
  "APIConnectionTimeoutError",
  "APIConnectionError",
  "RateLimitError",
  "AuthenticationError",
  "PermissionDeniedError",
  "BadRequestError",
  "NotFoundError",
  "InternalServerError",
  "APIError",
  "AnthropicError",
] as const;

const STABLE_NAME = /^[A-Z][A-Za-z]{2,}(?:Error|Exception)$/;

export function errorTypeOf(error: unknown): string {
  for (const name of SDK_ERRORS) {
    // SDK を差し替えたテストなどでクラスが無いこともあるので、関数のときだけ照合する
    const cls: unknown = (Anthropic as unknown as Record<string, unknown>)[name];
    if (typeof cls === "function" && error instanceof cls) return name;
  }
  const name = (error as { name?: unknown } | null)?.name;
  if (typeof name === "string" && STABLE_NAME.test(name)) return name;
  return error instanceof Error ? "Error" : typeof error;
}
