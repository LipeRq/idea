import { createClientKey } from "@idea/shared/http";

// Route Handler で使う、このアプリ用の送信元の判定と応答のヘルパー。
// 本文の読み取り(readBodyText)・JSON の解析(parseJson)は packages/shared の http.ts を直接使う。

/**
 * 回数制限のキーにする送信元。利用者が偽装できない値だけを使う(仕組みは packages/shared の http.ts。apps/diagnosis と同じ)。
 * - Vercel 上: Vercel が付ける x-vercel-forwarded-for
 * - INVENTORY_TRUST_PROXY=true(手前に信頼できるリバースプロキシが1段ある): x-forwarded-for の末尾
 * - それ以外: 全員で1つの枠を共有する("shared")
 */
export const clientKey = createClientKey("INVENTORY_TRUST_PROXY");

export const NO_STORE = { "Cache-Control": "no-store" };

export function errorResponse(status: number, code: string, error: string): Response {
  return Response.json({ error, code }, { status, headers: NO_STORE });
}
