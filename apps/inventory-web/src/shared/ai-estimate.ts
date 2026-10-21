// AI 版の依頼の大きさの見積もり。同意画面(Worker)とサーバーの受付で同じ計算を使い、
// 「画面では送れると表示したのにサーバーが 413 を返す」ことが起きないようにする。
// エンジンの generateAiDocument と同じ分割(buildUnits + batchUnits)で、要約の依頼回数と入力の大きさを数える。
// 統合の依頼に入る事実(factsText)は SDK を含むモジュールにあるため、構造部分の JSON から多めに見積もる。
import type { InventoryReport } from "@engine/browser";
import { batchUnits, buildUnits, estimateTokens } from "@engine/doc/chunk";

/** 1回の依頼ごとのシステムプロンプト・指示文の分(多めに見積もる) */
const PROMPT_OVERHEAD_TOKENS = 2_500;
/** 全体統合の依頼に入れる事実の上限(エンジンの reduceMaxTokens の既定値。超えると一覧を省略して渡す) */
const REDUCE_FACTS_CAP = 80_000;
/** 要約の結果(統合の依頼の入力になる)の見積もり */
const SUMMARY_TOKENS_PER_MODULE = 150;
const SUMMARY_TOKENS_PER_PROCEDURE = 60;

export interface AiRequestEstimate {
  /** 推定の入力トークン(要約と統合のすべての依頼の合計) */
  inputTokens: number;
  /** モジュールの要約の依頼回数(統合の1回は含まない) */
  batches: number;
}

export function estimateAiRequest(report: InventoryReport): AiRequestEstimate {
  const units = buildUnits(report);
  const batches = batchUnits(units);
  let tokens = 0;
  let summaries = 0;
  for (const u of units) {
    tokens += u.tokens + estimateTokens(u.procedures.join("、")) + 50;
    summaries += SUMMARY_TOKENS_PER_MODULE + u.procedures.length * SUMMARY_TOKENS_PER_PROCEDURE;
  }
  const structure = {
    ...report,
    vba: report.vba && { ...report.vba, modules: report.vba.modules.map((m) => ({ ...m, source: null })) },
    access: report.access && { ...report.access, queries: report.access.queries.map((q) => ({ ...q, sql: null })) },
  };
  const facts = Math.min(estimateTokens(JSON.stringify(structure)), REDUCE_FACTS_CAP);
  tokens += facts + Math.min(summaries, REDUCE_FACTS_CAP) + PROMPT_OVERHEAD_TOKENS * (batches.length + 1);
  return { inputTokens: tokens, batches: batches.length };
}
