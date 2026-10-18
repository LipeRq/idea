import { describe, expect, it } from "vitest";
import { calculateDiagnosis } from "./calculate";
import { buildFallbackReport } from "./fallback";
import type { DiagnosisInput } from "./schema";

const input: DiagnosisInput = {
  industry: "製造業",
  employees: "31〜100名",
  hourlyCost: 3_000,
  taskHours: { inquiry: 80, documents: 60, minutes: 40, dataEntry: 120, search: 50, reporting: 30 },
  readiness: {
    dataLocation: 1,
    manuals: 1,
    aiUsage: 1,
    itStaff: 1,
    rules: 1,
    leadership: 1,
  },
  goals: [],
};

describe("buildFallbackReport", () => {
  it("総評の数値は画面と同じ表記(桁区切り・万円)で書く", () => {
    const result = calculateDiagnosis(input);
    const { summary } = buildFallbackReport(result);
    // 年間1400.5時間・420万円(画面では「1,401時間」「420万円」)
    expect(result.totals.annualSavedHours).toBe(1400.5);
    expect(summary).toContain("月間合計380時間");
    expect(summary).toContain("年間約1,401時間(約420万円)");
    expect(summary).not.toContain("1400.5");
  });

  it("施策は上位業務と同じ順番・同じ件数", () => {
    const result = calculateDiagnosis(input);
    const report = buildFallbackReport(result);
    expect(report.recommendations.map((r) => r.taskId)).toEqual(
      result.top.map((t) => t.taskId),
    );
    expect(report.roadmap.map((r) => r.period)).toEqual(["1ヶ月目", "2ヶ月目", "3ヶ月目"]);
  });

  it("準備度が低い項目があれば、その整備を助言に入れる", () => {
    const report = buildFallbackReport(calculateDiagnosis(input));
    expect(report.readinessAdvice.length).toBeGreaterThanOrEqual(1);
    expect(report.readinessAdvice.length).toBeLessThanOrEqual(4);
    expect(report.roadmap[0].actions[0]).toBe("業務データの主な保存場所を整える");
  });
});
