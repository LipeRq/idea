import { describe, expect, it } from "vitest";
import { calculateDiagnosis } from "../diagnosis/calculate";
import { diagnosisInput, lead } from "./fixtures.test-helper";
import { leadDescription, summarizeDiagnosis, summaryLines } from "./summary";

describe("summarizeDiagnosis", () => {
  it("業種・規模・年間削減見込み額・準備度・優先施策の上位3件を、計算結果から取り出す", () => {
    const result = calculateDiagnosis(diagnosisInput);
    expect(summarizeDiagnosis(diagnosisInput, result)).toEqual({
      industry: "製造業",
      employees: "31〜100名",
      annualSavedAmount: result.totals.annualSavedAmount,
      annualSavedHours: result.totals.annualSavedHours,
      readinessScore: 100,
      readinessLevel: "推進段階",
      topTasks: result.top.slice(0, 3).map((t) => ({
        name: t.name,
        annualSavedAmount: t.annualSavedAmount,
      })),
    });
    expect(result.top.length).toBeGreaterThan(3);
  });
});

describe("summaryLines / leadDescription", () => {
  it("人が読める形にする", () => {
    // 議事録 100×60%=月60時間(年216万円)、データ入力 80×50%=月40時間(年144万円)、
    // 問い合わせ 50×40%=月20時間(年72万円)、集計 40×45%=月18時間 → 合計 年1,656時間・497万円
    expect(summaryLines(lead.summary)).toEqual([
      "業種:製造業",
      "従業員規模:31〜100名",
      "年間削減見込み額:497万円(年間約1,656時間)",
      "AI導入の準備度:100点(推進段階)",
      "優先施策の上位:1. 議事録・報告書の作成(年216万円) / 2. データ入力・転記(年144万円) / 3. 問い合わせ・メール対応(年72万円)",
    ]);
  });

  it("相談内容のあとに診断結果の要約を付ける", () => {
    const text = leadDescription(lead);
    expect(text.startsWith("【相談したい内容】\n見積書の作成を効率化したい\n\n【AI導入診断の結果】\n")).toBe(
      true,
    );
    expect(text).toContain("AI導入の準備度:100点(推進段階)");
  });
});
