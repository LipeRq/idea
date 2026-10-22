import { describe, expect, it } from "vitest";
import type { CaseRecord } from "../domain/impact";
import {
  compareStat,
  computeKpis,
  isEstimator,
  isReference,
  leadTimeDays,
  mean,
  median,
  MIN_RELIABLE_N,
  periodSeries,
  ratio,
  weekStart,
} from "./kpi";

// 手計算で検算できる小さなデータで確かめる。2026-10-19 は月曜日。

const ESTIMATORS = ["代表取締役 白石", "工場長 森"];

function rec(id: string, over: Partial<CaseRecord> = {}): CaseRecord {
  return {
    id,
    receivedAt: "2026-10-19",
    answeredAt: null,
    operator: null,
    workMinutes: null,
    aiUsed: false,
    aiCostJpy: null,
    aiProcessingMs: null,
    aiTokens: null,
    adoption: [],
    hourChangeRates: [],
    result: null,
    orderAmount: null,
    quotedCost: null,
    actualCost: null,
    reworkCount: null,
    ...over,
  };
}

describe("median / mean / ratio", () => {
  it("奇数件は真ん中、偶数件は真ん中2つの平均", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
  it("空・NaN だけなら null(0ではない)", () => {
    expect(median([])).toBeNull();
    expect(median([Number.NaN])).toBeNull();
    expect(mean([])).toBeNull();
  });
  it("NaN は除いて計算する", () => {
    expect(median([1, Number.NaN, 3])).toBe(2);
    expect(mean([2, Number.NaN, 4])).toBe(3);
  });
  it("割合は分母が0なら null", () => {
    expect(ratio(0, 0)).toBeNull();
    expect(ratio(0, 4)).toBe(0);
    expect(ratio(1, 4)).toBe(0.25);
  });
});

describe("leadTimeDays(営業日)", () => {
  it("同じ日は0、金曜→月曜は1、月曜→翌週月曜は5", () => {
    expect(leadTimeDays({ receivedAt: "2026-10-19", answeredAt: "2026-10-19" })).toBe(0);
    expect(leadTimeDays({ receivedAt: "2026-10-16", answeredAt: "2026-10-19" })).toBe(1);
    expect(leadTimeDays({ receivedAt: "2026-10-19", answeredAt: "2026-10-26" })).toBe(5);
    expect(leadTimeDays({ receivedAt: "2026-10-19", answeredAt: "2026-10-21" })).toBe(2);
  });
  it("回答日がない・受付日より前なら欠損(null)", () => {
    expect(leadTimeDays({ receivedAt: "2026-10-19", answeredAt: null })).toBeNull();
    expect(leadTimeDays({ receivedAt: "2026-10-19", answeredAt: "2026-10-16" })).toBeNull();
  });
});

describe("isEstimator", () => {
  it("名簿と部分一致(どちらが長くてもよい)で照合する", () => {
    expect(isEstimator("代表取締役 白石", ESTIMATORS)).toBe(true);
    expect(isEstimator("白石", ESTIMATORS)).toBe(true);
    expect(isEstimator("営業部 青木", ESTIMATORS)).toBe(false);
    expect(isEstimator("  ", ESTIMATORS)).toBe(false);
    expect(isEstimator("白石", [])).toBe(false);
  });
});

describe("computeKpis", () => {
  const records = [
    // 2営業日。担当者。受注・黒字(実績90,000 ≦ 受注100,000)
    rec("A", {
      answeredAt: "2026-10-21",
      operator: "代表取締役 白石",
      workMinutes: 30,
      result: "won",
      orderAmount: 100_000,
      quotedCost: 80_000,
      actualCost: 90_000,
      reworkCount: 0,
    }),
    // 5営業日。担当者以外。失注
    rec("B", { answeredAt: "2026-10-26", operator: "営業部 青木", workMinutes: 60, result: "lost" }),
    // 0営業日。担当者。受注・赤字(実績55,000 > 受注50,000)
    rec("C", {
      receivedAt: "2026-10-20",
      answeredAt: "2026-10-20",
      operator: "工場長 森",
      workMinutes: 90,
      result: "won",
      orderAmount: 50_000,
      quotedCost: 40_000,
      actualCost: 55_000,
      reworkCount: 2,
    }),
    // 未回答・作成者も作業時間も不明
    rec("D", { receivedAt: "2026-10-20" }),
  ];
  const k = computeKpis(records, ESTIMATORS);

  it("リードタイムは回答済みの中央値(2,5,0 → 2)。未回答は欠損", () => {
    expect(k.cases).toBe(4);
    expect(k.leadTimeDays).toEqual({ value: 2, n: 3, missing: 1 });
  });
  it("作業時間は平均(30,60,90 → 60)と中央値(60)", () => {
    expect(k.workMinutes).toEqual({ value: 60, n: 3, missing: 1 });
    expect(k.workMinutesMedian).toBe(60);
  });
  it("見積担当者以外の割合は、作成者が分かる3件のうち1件", () => {
    expect(k.nonEstimatorShare.value).toBeCloseTo(1 / 3, 10);
    expect(k.nonEstimatorShare).toMatchObject({ n: 3, missing: 1 });
  });
  it("受注率は受注2÷(受注2+失注1)", () => {
    expect(k.winRate.value).toBeCloseTo(2 / 3, 10);
    expect(k.winRate).toMatchObject({ n: 3, missing: 0 });
  });
  it("赤字は実績の入った受注2件のうち1件。原価差率の中央値は(0.125, 0.375)→0.25", () => {
    expect(k.deficitShare).toEqual({ value: 0.5, n: 2, missing: 0 });
    expect(k.costGapRate.value).toBeCloseTo(0.25, 10);
    expect(k.costGapRate.n).toBe(2);
  });
  it("手戻りは受注1件あたり(0,2 → 1)", () => {
    expect(k.reworkPerWon).toEqual({ value: 1, n: 2, missing: 0 });
  });
  it("AIを使っていない記録は、AI費用の対象にしない(0円ではなく対象なし)", () => {
    expect(k.aiCostJpy).toEqual({ value: null, n: 0, missing: 0 });
  });

  it("記録がなければ、件数0・値は null(0%や0日にしない)", () => {
    const empty = computeKpis([], ESTIMATORS);
    expect(empty.cases).toBe(0);
    for (const s of [empty.leadTimeDays, empty.workMinutes, empty.nonEstimatorShare, empty.winRate, empty.deficitShare, empty.reworkPerWon, empty.adoptionOverall]) {
      expect(s.value).toBeNull();
      expect(s.n).toBe(0);
    }
  });

  it("受注があっても実績原価がなければ、赤字の割合は null で欠損として数える", () => {
    const only = computeKpis([rec("W", { answeredAt: "2026-10-20", result: "won", orderAmount: 10_000 })], ESTIMATORS);
    expect(only.deficitShare).toEqual({ value: null, n: 0, missing: 1 });
    expect(only.costGapRate.value).toBeNull();
  });

  it("実績原価が受注額と等しければ赤字ではない", () => {
    const eq = computeKpis([rec("E", { answeredAt: "2026-10-20", result: "won", orderAmount: 10_000, actualCost: 10_000, quotedCost: 0 })], ESTIMATORS);
    expect(eq.deficitShare.value).toBe(0);
    // 見積原価が0のときは差率を出せない(欠損)
    expect(eq.costGapRate).toEqual({ value: null, n: 0, missing: 1 });
  });

  it("回答済みで受注・失注が未定のものは、受注率の分母に入れず欠損にする", () => {
    const k2 = computeKpis(
      [rec("1", { answeredAt: "2026-10-20", result: "won" }), rec("2", { answeredAt: "2026-10-20" }), rec("3")],
      ESTIMATORS,
    );
    expect(k2.winRate).toEqual({ value: 1, n: 1, missing: 1 });
  });

  it("作成者が空白の記録は、見積担当者以外の割合の分母に入れない", () => {
    const k2 = computeKpis([rec("1", { operator: "  " }), rec("2", { operator: "営業部 青木" })], ESTIMATORS);
    expect(k2.nonEstimatorShare).toEqual({ value: 1, n: 1, missing: 1 });
  });

  it("AIの費用は、AIを使った記録の平均", () => {
    const k2 = computeKpis(
      [
        rec("1", { aiUsed: true, aiCostJpy: 100, aiProcessingMs: 30_000, aiTokens: 20_000 }),
        rec("2", { aiUsed: true, aiCostJpy: 200, aiProcessingMs: 50_000, aiTokens: 40_000 }),
        rec("3", { aiUsed: true, aiCostJpy: null }),
        rec("4"),
      ],
      ESTIMATORS,
    );
    expect(k2.aiCostJpy).toEqual({ value: 150, n: 2, missing: 1 });
    expect(k2.aiProcessingMs.value).toBe(40_000);
    expect(k2.aiTokens.value).toBe(30_000);
  });

  it("項目別の採用率・修正率は、評価数と修正数の合計から出す(採用率+修正率=100%)", () => {
    const k2 = computeKpis(
      [
        rec("1", {
          adoption: [
            { item: "quote:hours", evaluated: 3, modified: 1 },
            { item: "field:material", evaluated: 1, modified: 0 },
          ],
          hourChangeRates: [0.1, 0.3],
        }),
        rec("2", {
          adoption: [
            { item: "quote:hours", evaluated: 2, modified: 1 },
            { item: "field:material", evaluated: 1, modified: 1 },
          ],
          hourChangeRates: [0.2],
        }),
        rec("3"),
      ],
      ESTIMATORS,
    );
    const hours = k2.adoption.find((a) => a.item === "quote:hours")!;
    expect(hours).toMatchObject({ evaluated: 5, modified: 2 });
    expect(hours.adoptedRate).toBeCloseTo(0.6, 10);
    expect(hours.modifiedRate).toBeCloseTo(0.4, 10);
    expect(k2.adoption.find((a) => a.item === "field:material")!.adoptedRate).toBe(0.5);
    // 全体:評価7・修正3 → 採用4/7。項目を評価した記録は2件(3件目は欠損)
    expect(k2.adoptionOverall.value).toBeCloseTo(4 / 7, 10);
    expect(k2.adoptionOverall).toMatchObject({ n: 2, missing: 1 });
    // 抽出項目が先、見積の項目が後(定義の順)
    expect(k2.adoption.map((a) => a.item)).toEqual(["field:material", "quote:hours"]);
    expect(k2.hourChange).toEqual({ value: 0.2, n: 3, missing: 0 });
  });

  it("修正数が評価数を超えていても、評価数までに丸める", () => {
    const k2 = computeKpis([rec("1", { adoption: [{ item: "quote:hours", evaluated: 1, modified: 5 }] })], ESTIMATORS);
    expect(k2.adoption[0].modifiedRate).toBe(1);
  });
});

describe("参考値", () => {
  it(`件数が${MIN_RELIABLE_N}件未満なら参考値。値がなければ参考値とも言わない`, () => {
    expect(isReference({ value: 1, n: MIN_RELIABLE_N - 1, missing: 0 })).toBe(true);
    expect(isReference({ value: 1, n: MIN_RELIABLE_N, missing: 0 })).toBe(false);
    expect(isReference({ value: null, n: 0, missing: 3 })).toBe(false);
  });
});

describe("期間ごとの集計", () => {
  it("週は月曜始まり(日曜は前の週)", () => {
    expect(weekStart("2026-10-19")).toBe("2026-10-19");
    expect(weekStart("2026-10-25")).toBe("2026-10-19");
    expect(weekStart("2026-10-18")).toBe("2026-10-12");
    expect(weekStart("2026-01-01")).toBe("2025-12-29");
  });

  it("記録のない週も、件数0で連続して並べる", () => {
    const s = periodSeries(
      [rec("1", { receivedAt: "2026-10-05" }), rec("2", { receivedAt: "2026-10-07" }), rec("3", { receivedAt: "2026-10-20" })],
      "week",
      ESTIMATORS,
    );
    expect(s.map((p) => [p.key, p.kpis.cases])).toEqual([
      ["2026-10-05", 2],
      ["2026-10-12", 0],
      ["2026-10-19", 1],
    ]);
    expect(s[0].label).toBe("10/5");
  });

  it("月は年をまたいでも連続する", () => {
    const s = periodSeries([rec("1", { receivedAt: "2026-11-30" }), rec("2", { receivedAt: "2027-02-01" })], "month", ESTIMATORS);
    expect(s.map((p) => p.key)).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(s[1].longLabel).toBe("2026年12月");
  });

  it("記録がなければ空", () => {
    expect(periodSeries([], "week", ESTIMATORS)).toEqual([]);
  });

  it("期間の数に上限がある(日付の誤入力で何千も並ばない)", () => {
    const s = periodSeries([rec("1", { receivedAt: "2001-01-01" }), rec("2", { receivedAt: "2026-10-19" })], "week", ESTIMATORS);
    expect(s.length).toBe(60);
    expect(s[s.length - 1].key).toBe("2026-10-19");
  });
});

describe("compareStat", () => {
  const s = (value: number | null, n = 20) => ({ value, n, missing: 0 });
  it("小さいほど良い指標:減れば良い方向、差と変化率を出す", () => {
    expect(compareStat(s(4), s(2.5), "lower")).toMatchObject({ diff: -1.5, rate: -0.375, verdict: "better", reference: false });
    expect(compareStat(s(4), s(5), "lower").verdict).toBe("worse");
  });
  it("大きいほど良い指標", () => {
    expect(compareStat(s(0.1), s(0.4), "higher").verdict).toBe("better");
  });
  it("同じ値は変化なし。方向を決めない指標、どちらかが null なら判定しない", () => {
    expect(compareStat(s(3), s(3), "lower").verdict).toBe("same");
    expect(compareStat(s(3), s(2), "none").verdict).toBe("unknown");
    expect(compareStat(s(null), s(2), "lower")).toMatchObject({ diff: null, rate: null, verdict: "unknown" });
  });
  it("導入前が0のときは変化率を出さない。どちらかが参考値なら reference", () => {
    expect(compareStat(s(0), s(0.2), "lower").rate).toBeNull();
    expect(compareStat(s(4, 5), s(2), "lower").reference).toBe(true);
  });
});
