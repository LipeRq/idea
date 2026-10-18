import { calculateDiagnosis } from "../diagnosis/calculate";
import type { DiagnosisInput } from "../diagnosis/schema";
import { summarizeDiagnosis } from "./summary";
import type { Lead } from "./types";

// 申し込みのテストで使う共通のデータ

export const diagnosisInput: DiagnosisInput = {
  companyName: "テスト工業",
  industry: "製造業",
  employees: "31〜100名",
  hourlyCost: 3_000,
  taskHours: { minutes: 100, inquiry: 50, dataEntry: 80, reporting: 40 },
  readiness: { dataLocation: 3, manuals: 3, aiUsage: 3, itStaff: 3, rules: 3, leadership: 3 },
  goals: ["人手不足への対応"],
};

export const lead: Lead = {
  contact: {
    companyName: "テスト工業",
    name: "山田 太郎",
    email: "taro@example.co.jp",
    phone: "03-1234-5678",
    message: "見積書の作成を効率化したい",
  },
  summary: summarizeDiagnosis(diagnosisInput, calculateDiagnosis(diagnosisInput)),
  submittedAt: new Date("2026-10-18T01:00:00Z"),
};

/** fetch のモックに渡された本文(URLSearchParams か文字列) */
export function sentBody(call: unknown[]): string {
  const init = call[1] as RequestInit;
  return String(init.body);
}
