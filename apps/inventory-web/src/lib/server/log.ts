// AI 版のサーバーログ。1リクエスト1行の JSON だけを console.info で出す。
// 出さないもの: 本文・抽出結果の中身・ファイル名・モジュール名・SQL・AI の出力・IP アドレス・User-Agent・アクセスコード・
// エラーオブジェクト全体(メッセージに入力の一部が含まれることがあるため、クラス名と HTTP ステータスだけを出す。
// 取り出しは packages/shared の log.ts の errorClassOf)。

export type AiOutcome =
  | "ok"
  | "disabled"
  | "forbidden"
  | "access_locked"
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
