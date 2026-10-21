// AI 版のサーバーログ。1リクエスト1行の JSON だけを console.info で出す。
// 出さないもの: 本文・抽出結果の中身・ファイル名・モジュール名・SQL・AI の出力・IP アドレス・User-Agent・アクセスコード・
// エラーオブジェクト全体(メッセージに入力の一部が含まれることがあるため、クラス名と HTTP ステータスだけを出す)。

export type AiOutcome =
  | "ok"
  | "disabled"
  | "forbidden"
  | "rate_limited"
  | "unsupported_media_type"
  | "invalid"
  | "consent_outdated"
  | "too_large"
  | "daily_limit"
  | "store_unavailable"
  | "ai_error"
  | "aborted"
  | "internal";

export interface AiLogEntry {
  outcome: AiOutcome;
  mode: string;
  durationMs: number;
  bodyBytes?: number;
  modules?: number;
  procedures?: number;
  estimatedTokens?: number;
  batches?: number;
  errorClass?: string;
  errorStatus?: number;
}

export function logAiRequest(entry: AiLogEntry): void {
  console.info(JSON.stringify({ event: "ai_document", time: new Date().toISOString(), ...entry }));
}

/** エラーの種類だけを取り出す(メッセージは出さない) */
export function errorClassOf(e: unknown): { errorClass: string; errorStatus?: number } {
  const errorClass = e instanceof Error ? (e.constructor?.name && e.constructor.name !== "Error" ? e.constructor.name : e.name) : typeof e;
  const status = (e as { status?: unknown } | null)?.status;
  return { errorClass: errorClass.slice(0, 60), ...(typeof status === "number" ? { errorStatus: status } : {}) };
}
