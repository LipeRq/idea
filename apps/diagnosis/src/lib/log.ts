import Anthropic from "@anthropic-ai/sdk";

// 例外のログ(apps/quote-assist の src/lib/log.ts と同じ方針)。
// 例外オブジェクトをそのまま console.error に渡すと、メッセージ・原因(cause)・API の応答本文に入力内容(会社名・業務の記述など)が
// 含まれてログに残ることがあるため、例外の種類と HTTP ステータスだけを記録する。

export function logError(message: string, error: unknown): void {
  const status = (error as { status?: unknown } | null)?.status;
  console.error(message, JSON.stringify({ errorType: errorTypeOf(error), status: typeof status === "number" ? status : null }));
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
