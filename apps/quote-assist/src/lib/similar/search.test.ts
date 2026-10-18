import { beforeAll, describe, expect, it } from "vitest";
import type { Defect, PastCase, RateTable } from "../domain/reference";
import type { Spec } from "../domain/inquiry";
import { loadReferenceData, type ReferenceData } from "../reference/load";
import { DATA_DIR } from "../test-helpers";
import {
  buildCaseQuery,
  caseWarnings,
  scoreCase,
  searchSimilarCases,
  sizeSimilarity,
  textSimilarity,
  WEIGHTS,
} from "./search";

let ref: ReferenceData;
beforeAll(async () => {
  ref = await loadReferenceData(DATA_DIR);
});

const spec = (over: Partial<Spec> = {}): Spec => ({
  customerId: "C01",
  customerName: "ミナモト装置工業株式会社",
  contactName: null,
  partName: "センサブラケット",
  drawingNumber: "MS-24017",
  revision: "C",
  materialId: "SUS304",
  materialCandidates: [],
  quantity: 50,
  dimensions: { shape: "block", lengthMm: 120, widthMm: 60, heightMm: 25, diameterMm: null },
  toleranceMm: 0.01,
  surfaceTreatmentId: "electroless_ni",
  surfaceTreatmentCandidates: [],
  heatTreatmentId: null,
  heatTreatmentCandidates: [],
  dueDate: null,
  inspection: null,
  processType: "milling",
  features: ["φ8H7リーマ穴×2"],
  notes: [],
  ...over,
});

function pastCase(over: Partial<PastCase> = {}): PastCase {
  return {
    id: "Q-T-1",
    quotedAt: "2025-01-01",
    customerId: "C09",
    drawingNumber: "XX-00001",
    revision: "A",
    partName: "ブロック",
    processType: "milling",
    dimensions: { shape: "block", lengthMm: 120, widthMm: 60, heightMm: 25, diameterMm: null },
    materialId: "SUS304",
    weightKg: 1,
    toleranceMm: 0.1,
    surfaceTreatmentId: null,
    heatTreatmentId: null,
    features: [],
    notes: "",
    quantity: 10,
    estimatedProcesses: [{ processId: "mc", setupHours: 1, cycleHoursPerPiece: 1 }],
    actualProcesses: null,
    unitPrice: 10_000,
    amount: 100_000,
    result: "won",
    lostReason: null,
    responseDays: 3,
    defectIds: [],
    ...over,
  };
}

describe("textSimilarity / sizeSimilarity", () => {
  it("同じ文字列は1、共通の2-gramがなければ0", () => {
    expect(textSimilarity("センサブラケット", "センサブラケット")).toBeCloseTo(1);
    expect(textSimilarity("シャフト", "プレート")).toBe(0);
    expect(textSimilarity("", "プレート")).toBe(0);
  });

  it("品名が部分的に同じなら0と1の間", () => {
    const s = textSimilarity("センサブラケット", "ガイドブラケット");
    expect(s).toBeGreaterThan(0.3);
    expect(s).toBeLessThan(1);
  });

  it("全角・半角の違いは無視する", () => {
    expect(textSimilarity("Ｍ５タップ", "M5タップ")).toBeCloseTo(1);
  });

  it("寸法は向き(並び順)によらず比べる", () => {
    const a = { shape: "block" as const, lengthMm: 120, widthMm: 60, heightMm: 25, diameterMm: null };
    const b = { shape: "block" as const, lengthMm: 25, widthMm: 120, heightMm: 60, diameterMm: null };
    expect(sizeSimilarity(a, b)).toBe(1);
    expect(sizeSimilarity(a, { ...a, lengthMm: 60 })).toBeCloseTo((0.5 + 1 + 1) / 3);
  });
});

describe("scoreCase", () => {
  const rates = (): RateTable => ref.rates;

  it("同じ図番の旧版・同材質・同加工種別・同サイズで高得点になり、理由に旧版と出る", () => {
    const query = buildCaseQuery(spec(), rates());
    const r = scoreCase(query, pastCase({ drawingNumber: "MS-24017", revision: "B", customerId: "C01" }), rates());
    expect(r.breakdown.find((b) => b.factor === "drawing")!.points).toBe(WEIGHTS.drawing);
    expect(r.reasons[0]).toBe("同じ図番の旧版(Rev.B)");
    // 図番25+材質20+加工種別15+サイズ15+熱処理3+顧客2(品名・公差・表面処理は一致しない)
    expect(r.score).toBe(80);
  });

  it("材質が同じ系統なら材質点は半分", () => {
    const query = buildCaseQuery(spec(), rates());
    const r = scoreCase(query, pastCase({ materialId: "SUS303" }), rates());
    expect(r.breakdown.find((b) => b.factor === "material")!.points).toBe(WEIGHTS.material / 2);
  });

  it("材質が「アルミ」だけでも候補の系統で比べる", () => {
    const query = buildCaseQuery(spec({ materialId: null, materialCandidates: ["A5052", "A6061"] }), rates());
    expect(query.materialGroup).toBe("aluminum");
    const r = scoreCase(query, pastCase({ materialId: "A6061" }), rates());
    expect(r.breakdown.find((b) => b.factor === "material")!.points).toBe(WEIGHTS.material / 2);
  });

  it("配点の合計は100", () => {
    expect(Object.values(WEIGHTS).reduce((s, w) => s + w, 0)).toBe(100);
  });
});

describe("caseWarnings", () => {
  const defects: Defect[] = [
    { id: "D-1", caseId: "Q-T-1", drawingNumber: "XX", date: "2025-02-01", category: "めっき不良", description: "ムラ", countermeasure: "" },
  ];

  it("実績工数が見積工数を15%以上上回ったら赤字の可能性として警告する", () => {
    const c = pastCase({
      estimatedProcesses: [{ processId: "mc", setupHours: 1, cycleHoursPerPiece: 1.2 }],
      actualProcesses: [{ processId: "mc", setupHours: 1, cycleHoursPerPiece: 1.6 }],
    });
    expect(caseWarnings(c, [])).toEqual(["見積工数1.2時間に対し実績1.6時間(1個あたり、+33%)。赤字の可能性"]);
  });

  it("15%以内の超過、失注理由、不具合", () => {
    const c = pastCase({
      actualProcesses: [{ processId: "mc", setupHours: 1, cycleHoursPerPiece: 1.1 }],
      result: "lost",
      lostReason: "価格(他社より高い)",
      defectIds: ["D-1"],
    });
    expect(caseWarnings(c, defects)).toEqual(["失注:価格(他社より高い)", "不具合:めっき不良(ムラ)"]);
  });
});

describe("searchSimilarCases(合成データ)", () => {
  it("改訂品の引き合いでは、同じ図番の旧版が1位で、赤字と不具合の警告が付く", () => {
    const result = searchSimilarCases(buildCaseQuery(spec(), ref.rates), ref.cases, ref.rates, ref.defects);
    const top = ref.cases.find((c) => c.id === result[0].caseId)!;
    expect(top.drawingNumber).toBe("MS-24017");
    expect(top.revision).toBe("B");
    expect(result[0].warnings.some((w) => w.includes("赤字"))).toBe(true);
    expect(result[0].warnings.some((w) => w.startsWith("不具合"))).toBe(true);
    // 2位以下も同材質・同加工種別
    for (const s of result.slice(1, 3)) {
      const c = ref.cases.find((x) => x.id === s.caseId)!;
      expect(c.materialId).toBe("SUS304");
      expect(c.processType).toBe("milling");
    }
  });

  it("スコアの高い順に最大8件、30点未満は返さない", () => {
    const result = searchSimilarCases(buildCaseQuery(spec(), ref.rates), ref.cases, ref.rates, ref.defects);
    expect(result.length).toBeLessThanOrEqual(8);
    expect(result.every((r) => r.score >= 30)).toBe(true);
    expect(result.map((r) => r.score)).toEqual([...result.map((r) => r.score)].sort((a, b) => b - a));
  });

  it("何も分からない引き合いでは候補が出ない", () => {
    const empty = spec({
      customerId: null,
      partName: null,
      drawingNumber: null,
      materialId: null,
      dimensions: null,
      processType: null,
      features: [],
      surfaceTreatmentId: "none",
      toleranceMm: 0.01,
    });
    expect(searchSimilarCases(buildCaseQuery(empty, ref.rates), ref.cases, ref.rates, ref.defects)).toEqual([]);
  });
});
