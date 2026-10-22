// AI 版のサーバーログ。1リクエスト1行の JSON だけを console.info で出す。
// 出さないもの: 本文・抽出結果の中身・ファイル名・モジュール名・SQL・AI の出力・IP アドレス・User-Agent・アクセスコード・
// エラーオブジェクト全体(メッセージに入力の一部が含まれることがあるため、クラス名と HTTP ステータスだけを出す)。

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

// 本番ビルドではクラス名が短く潰れる(例:"s")ため、constructor.name は使わない。
// 潰れない名前(組み込みの TypeError・AbortError・TimeoutError など)だけを使い、それ以外は Error とする。
const STABLE_NAME = /^[A-Z][A-Za-z]{2,}(?:Error|Exception)$/;

/** エラーの種類だけを取り出す(メッセージは出さない) */
export function errorClassOf(e: unknown): { errorClass: string; errorStatus?: number } {
  const name = (e as { name?: unknown } | null)?.name;
  const errorClass =
    typeof name === "string" && STABLE_NAME.test(name) ? name : e instanceof Error ? "Error" : typeof e;
  const status = (e as { status?: unknown } | null)?.status;
  return { errorClass: errorClass.slice(0, 60), ...(typeof status === "number" ? { errorStatus: status } : {}) };
}
