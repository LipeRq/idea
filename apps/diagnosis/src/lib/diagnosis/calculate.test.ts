import { describe, expect, it } from "vitest";
import {
  calculateDiagnosis,
  calculateReadiness,
  realizationFactorFor,
} from "./calculate";
import { DiagnosisInputSchema, type DiagnosisInput } from "./schema";

const allMax = {
  dataLocation: 3,
  manuals: 3,
  aiUsage: 3,
  itStaff: 3,
  rules: 3,
  leadership: 3,
} as const;

const allZero = {
  dataLocation: 0,
  manuals: 0,
  aiUsage: 0,
  itStaff: 0,
  rules: 0,
  leadership: 0,
} as const;

function input(overrides: Partial<DiagnosisInput> = {}): DiagnosisInput {
  return {
    industry: "製造業",
    employees: "31〜100名",
    hourlyCost: 3_000,
    taskHours: { minutes: 100 },
    readiness: { ...allMax },
    goals: ["コスト削減"],
    ...overrides,
  };
}

describe("calculateReadiness", () => {
  it("全項目が最高なら100点で推進段階", () => {
    const r = calculateReadiness(allMax);
    expect(r.score).toBe(100);
    expect(r.level).toBe("advanced");
  });

  it("全項目が最低なら0点で準備段階", () => {
    const r = calculateReadiness(allZero);
    expect(r.score).toBe(0);
    expect(r.level).toBe("preparation");
  });

  it("重みどおりに配点される(データ保存場所だけ最高なら25点)", () => {
    const r = calculateReadiness({ ...allZero, dataLocation: 3 });
    expect(r.score).toBe(25);
  });
});

describe("realizationFactorFor", () => {
  it("準備度0なら効果は半分、100なら満額", () => {
    expect(realizationFactorFor(0)).toBe(0.5);
    expect(realizationFactorFor(100)).toBe(1);
  });
});

describe("calculateDiagnosis", () => {
  it("議事録100時間・準備度100点なら月60時間、年216万円の削減", () => {
    const result = calculateDiagnosis(input());
    const minutes = result.tasks[0];
    expect(minutes.taskId).toBe("minutes");
    expect(minutes.monthlySavedHours).toBe(60);
    expect(minutes.annualSavedHours).toBe(720);
    expect(minutes.annualSavedAmount).toBe(2_160_000);
  });

  it("投資回収月数 = 初期費用 ÷ (月の削減額 − 月額費用)", () => {
    const result = calculateDiagnosis(input());
    // 月の削減額18万円 − 月額1万円 = 17万円、初期10万円 → 1ヶ月
    expect(result.tasks[0].paybackMonths).toBe(1);
  });

  it("月の削減額が運用費を下回る場合は回収不可(null)", () => {
    const result = calculateDiagnosis(input({ taskHours: { minutes: 1 } }));
    expect(result.tasks[0].paybackMonths).toBeNull();
  });

  it("前提条件が整っていない業務は難易度が1段上がる", () => {
    const ready = calculateDiagnosis(input({ taskHours: { search: 50 } }));
    const notReady = calculateDiagnosis(
      input({
        taskHours: { search: 50 },
        readiness: { ...allMax, dataLocation: 1 },
      }),
    );
    expect(ready.tasks[0].difficulty).toBe(2);
    expect(ready.tasks[0].prerequisiteGap).toBe(false);
    expect(notReady.tasks[0].difficulty).toBe(3);
    expect(notReady.tasks[0].prerequisiteGap).toBe(true);
  });

  it("時間0の業務は結果に含めず、優先度順に上位5件を返す", () => {
    const result = calculateDiagnosis(
      input({
        taskHours: {
          inquiry: 80,
          documents: 40,
          minutes: 20,
          dataEntry: 120,
          accounting: 0,
          search: 30,
          reporting: 60,
          manual: 10,
        },
      }),
    );
    expect(result.tasks).toHaveLength(7);
    expect(result.top).toHaveLength(5);
    const scores = result.tasks.map((t) => t.priorityScore);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(result.tasks.some((t) => t.taskId === "accounting")).toBe(false);
  });

  it("小数の工数を足しても合計に浮動小数の誤差が出ない", () => {
    const result = calculateDiagnosis(
      input({ taskHours: { minutes: 10.1, inquiry: 20.2 } }),
    );
    expect(result.totals.monthlyHours).toBe(30.3);
  });

  it("実現係数は計算に使った値を丸めずに返す(準備度33点 → 0.665)", () => {
    const allOne = {
      dataLocation: 1,
      manuals: 1,
      aiUsage: 1,
      itStaff: 1,
      rules: 1,
      leadership: 1,
    } as const;
    const result = calculateDiagnosis(input({ readiness: allOne }));
    expect(result.readiness.score).toBe(33);
    expect(result.realizationFactor).toBe(0.665);
    // 100時間 × 60% × 0.665 = 月39.9時間
    expect(result.tasks[0].monthlySavedHours).toBe(39.9);
  });
});

describe("DiagnosisInputSchema", () => {
  it("業務時間がすべて0だとエラー", () => {
    const parsed = DiagnosisInputSchema.safeParse(
      input({ taskHours: { minutes: 0 } }),
    );
    expect(parsed.success).toBe(false);
  });

  it("準備度の回答が欠けているとエラー", () => {
    const partial: Partial<Record<keyof typeof allMax, number>> = { ...allMax };
    delete partial.leadership;
    const parsed = DiagnosisInputSchema.safeParse({
      ...input(),
      readiness: partial,
    });
    expect(parsed.success).toBe(false);
  });
});
