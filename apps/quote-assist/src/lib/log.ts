import Anthropic from "@anthropic-ai/sdk";
import { errorStatusOf, errorTypeOf as sharedErrorTypeOf } from "@idea/shared/log";

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
  console.error(
    JSON.stringify({
      at: new Date().toISOString(),
      event,
      errorType: errorTypeOf(error),
      status: errorStatusOf(error),
      ...fields,
    }),
  );
}

/**
 * 例外の種類の名前(取り出し方は packages/shared の log.ts。本番ビルドで潰れたクラス名は使わない)。
 * このアプリの Claude SDK の例外はクラスで照合する。
 */
export function errorTypeOf(error: unknown): string {
  return sharedErrorTypeOf(error, Anthropic);
}
