import { READINESS_LEVEL_LABEL, type DiagnosisResult } from "../diagnosis/calculate";
import type { DiagnosisInput } from "../diagnosis/schema";
import { formatHours, formatYen } from "../format";
import type { DiagnosisSummary, Lead } from "./types";

/** 申し込みに添える優先施策の件数 */
export const SUMMARY_TOP_TASKS = 3;

export function summarizeDiagnosis(
  input: DiagnosisInput,
  result: DiagnosisResult,
): DiagnosisSummary {
  return {
    industry: input.industry,
    employees: input.employees,
    annualSavedAmount: result.totals.annualSavedAmount,
    annualSavedHours: result.totals.annualSavedHours,
    readinessScore: result.readiness.score,
    readinessLevel: READINESS_LEVEL_LABEL[result.readiness.level],
    topTasks: result.top.slice(0, SUMMARY_TOP_TASKS).map((t) => ({
      name: t.name,
      annualSavedAmount: t.annualSavedAmount,
    })),
  };
}

export function formatTopTasks(summary: DiagnosisSummary): string {
  return summary.topTasks
    .map((t, i) => `${i + 1}. ${t.name}(年${formatYen(t.annualSavedAmount)})`)
    .join(" / ");
}

/** 人が読む形の要約(Salesforce の説明欄や Slack の本文に使う) */
export function summaryLines(summary: DiagnosisSummary): string[] {
  return [
    `業種:${summary.industry}`,
    `従業員規模:${summary.employees}`,
    `年間削減見込み額:${formatYen(summary.annualSavedAmount)}(年間約${formatHours(summary.annualSavedHours)})`,
    `AI導入の準備度:${summary.readinessScore}点(${summary.readinessLevel})`,
    `優先施策の上位:${formatTopTasks(summary)}`,
  ];
}

/** 申し込み内容の全文(相談内容+診断結果の要約) */
export function leadDescription(lead: Lead): string {
  return [
    "【相談したい内容】",
    lead.contact.message,
    "",
    "【AI導入診断の結果】",
    ...summaryLines(lead.summary),
  ].join("\n");
}
