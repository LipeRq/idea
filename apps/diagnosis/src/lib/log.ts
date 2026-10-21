// 例外のログ(apps/quote-assist の src/lib/log.ts と同じ方針)。
// 例外オブジェクトをそのまま console.error に渡すと、メッセージ・原因(cause)・API の応答本文に入力内容(会社名・業務の記述など)が
// 含まれてログに残ることがあるため、例外の種類と HTTP ステータスだけを記録する。

export function logError(message: string, error: unknown): void {
  const e = error as { name?: unknown; status?: unknown; constructor?: { name?: unknown } } | null;
  const ctor = e?.constructor?.name;
  const errorType = typeof ctor === "string" && ctor !== "Object" ? ctor : typeof e?.name === "string" ? e.name : typeof error;
  console.error(message, JSON.stringify({ errorType: errorType.slice(0, 60), status: typeof e?.status === "number" ? e.status : null }));
}
