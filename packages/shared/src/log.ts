// 例外をログに出すときの「種類」の取り出し(サーバー専用)。
// 例外オブジェクトをそのまま console.error に渡すと、メッセージ・原因(cause)・API の応答本文に入力内容が含まれて
// ログに残ることがあるため、各アプリのログは例外の種類と HTTP ステータスだけを記録する。
//
// 本番ビルドではクラス名が短く潰れる(例:"s")ため、constructor.name は使わない。
// Claude SDK の例外はクラスで照合し、それ以外は潰れない名前(組み込みの TypeError・AbortError など)だけを使う。
// SDK はこのパッケージの依存にしない(アプリと別の SDK のクラスで照合すると instanceof が合わない)。
// アプリが自分の SDK(import Anthropic from "@anthropic-ai/sdk")を渡す。

/** 子クラスを先に並べる(APIConnectionTimeoutError は APIConnectionError の子、どれも APIError の子) */
export const SDK_ERROR_NAMES = [
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

/**
 * 例外の種類の名前。メッセージは返さない。
 * @param sdk Claude SDK の既定のエクスポート(Anthropic)。渡すと、SDK の例外を潰れない名前で返す
 */
export function errorTypeOf(error: unknown, sdk?: object): string {
  if (sdk) {
    for (const name of SDK_ERROR_NAMES) {
      // SDK を差し替えたテストなどでクラスが無いこともあるので、関数のときだけ照合する
      const cls: unknown = (sdk as Record<string, unknown>)[name];
      if (typeof cls === "function" && error instanceof cls) return name;
    }
  }
  const name = (error as { name?: unknown } | null)?.name;
  if (typeof name === "string" && STABLE_NAME.test(name)) return name;
  return error instanceof Error ? "Error" : typeof error;
}

/** 例外の HTTP ステータス(数値でなければ null) */
export function errorStatusOf(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
}

/** 例外の種類(60文字まで)と HTTP ステータスだけを取り出す(1行の JSON ログ用) */
export function errorClassOf(error: unknown, sdk?: object): { errorClass: string; errorStatus?: number } {
  const status = errorStatusOf(error);
  return { errorClass: errorTypeOf(error, sdk).slice(0, 60), ...(status !== null ? { errorStatus: status } : {}) };
}
