import type { BaselineRow, CaseRecord } from "../domain/impact";

// 導入前の記録シート(BaselineRow)を、集計の入力(CaseRecord)にする。
// 画面(ブラウザ)でも使うため、AIクライアントなどサーバー側の部品には依存させない。

export function baselineRowToRecord(row: BaselineRow, index: number): CaseRecord {
  const workMinutes =
    row.salesMinutes === null && row.estimatorMinutes === null ? null : (row.salesMinutes ?? 0) + (row.estimatorMinutes ?? 0);
  return {
    id: `baseline-${index + 1}`,
    receivedAt: row.receivedAt,
    answeredAt: row.answeredAt,
    operator: row.estimator.trim() || null,
    workMinutes,
    aiUsed: false,
    aiCostJpy: null,
    aiProcessingMs: null,
    aiTokens: null,
    adoption: [],
    hourChangeRates: [],
    result: row.result,
    orderAmount: row.orderAmount,
    quotedCost: row.quotedCost,
    actualCost: row.actualCost,
    reworkCount: row.reworkCount,
  };
}

/** メモに「推定」とある行(実測できず推定した値を含む行)の数 */
export function countEstimatedRows(rows: readonly BaselineRow[]): number {
  return rows.filter((r) => r.memo.includes("推定")).length;
}

