import type { LeadContact } from "./schema";

/** 申し込みに添える診断結果の要約(サーバーで入力から計算し直したもの) */
export type DiagnosisSummary = {
  industry: string;
  employees: string;
  annualSavedAmount: number;
  annualSavedHours: number;
  readinessScore: number;
  readinessLevel: string;
  /** 優先施策の上位(業務名と年間削減見込み額) */
  topTasks: { name: string; annualSavedAmount: number }[];
};

export type Lead = {
  contact: Omit<LeadContact, "consent">;
  summary: DiagnosisSummary;
  submittedAt: Date;
};

/** 申し込みの送信先。環境変数の設定に応じて選ばれる */
export type LeadAdapter = {
  name: string;
  send(lead: Lead): Promise<void>;
};
