import { describe, expect, it } from "vitest";
import type { RateTable } from "../domain/reference";
import { blankWeightKg, calculateQuote, partWeightKg, quantityFactor, QuoteInputError, standardLeadDays } from "./calculate";
import type { QuoteInput } from "./types";

// 手計算しやすい値にしたテスト用の単価表
const rates: RateTable = {
  id: "RT-TEST",
  name: "テスト単価表",
  updatedAt: "2026-09-01",
  processes: [
    { id: "mc", name: "マシニング加工", chargePerHour: 8000, setupChargePerHour: 6000, types: ["milling"] },
    { id: "inspection", name: "検査", chargePerHour: 6000, setupChargePerHour: 5000, types: ["milling"] },
  ],
  materials: [
    { id: "SS400", name: "SS400", group: "steel", aliases: [], densityGPerCm3: 8, pricePerKg: 200, minChargePerLot: 1000 },
  ],
  treatments: [
    { id: "plating", name: "めっき", kind: "surface", aliases: [], pricing: "per_kg", unitPrice: 1000, minLotCharge: 5000, leadDays: 5, materialGroups: ["steel"] },
    { id: "hardening", name: "焼入れ", kind: "heat", aliases: [], pricing: "per_piece", unitPrice: 300, minLotCharge: 2000, leadDays: 3, materialGroups: ["steel"] },
  ],
  rules: {
    overheadRate: 0.1,
    defaultProfitRate: 0.2,
    blankAllowanceMm: {
      block: { lengthMm: 0, widthMm: 0, heightMm: 0, diameterMm: 0 },
      round: { lengthMm: 5, widthMm: 0, heightMm: 0, diameterMm: 3 },
      sheet: { lengthMm: 10, widthMm: 10, heightMm: 0, diameterMm: 0 },
    },
    quantityBreaks: [
      { minQty: 1, factor: 1 },
      { minQty: 10, factor: 0.9 },
    ],
    quantityTiers: [1, 10],
    leadTime: { baseDays: 5, extraDaysPer50Pieces: 1 },
    expedite: { surchargeRate: 0.25 },
    rounding: { unitStepYen: 10 },
    taxRate: 0.1,
    quoteValidityDays: 30,
    priceDeviationWarnRate: 0.4,
    staleAfterDays: 180,
  },
};

// 100×50×25mm = 125cm³ × 8g/cm³ = 1kg(取り代0)
const base: QuoteInput = {
  quantity: 5,
  material: {
    materialId: "SS400",
    dimensions: { shape: "block", lengthMm: 100, widthMm: 50, heightMm: 25, diameterMm: null },
    pricePerKgOverride: null,
  },
  processes: [
    { processId: "mc", setupHours: 1, cycleHoursPerPiece: 0.5, chargeOverride: null, source: { kind: "ai", caseIds: ["Q-1"], note: null } },
  ],
  treatments: [],
  profitRate: 0.2,
  expedite: false,
};

const amount = (r: ReturnType<typeof calculateQuote>, kind: string) =>
  r.lines.filter((l) => l.kind === kind).reduce((s, l) => s + l.amount, 0);

describe("calculateQuote", () => {
  it("材料費・加工費・段取り費・管理費・利益を計算式どおりに積み上げる", () => {
    const r = calculateQuote(base, rates);
    // 材料 1kg×5個×200円 = 1,000円(最低材料費と同額)
    expect(amount(r, "material")).toBe(1000);
    // 加工 0.5h×5個×8,000円 = 20,000円、段取り 1h×6,000円 = 6,000円
    expect(amount(r, "process")).toBe(20_000);
    expect(amount(r, "setup")).toBe(6000);
    expect(r.directCost).toBe(27_000);
    expect(r.overhead).toBe(2700);
    // (27,000+2,700)×20% = 5,940
    expect(r.profit).toBe(5940);
    expect(r.rawTotal).toBe(35_640);
    // 35,640÷5 = 7,128 → 10円単位に切り上げて 7,130円、合計 35,650円(端数調整 +10円)
    expect(r.unitPrice).toBe(7130);
    expect(r.total).toBe(35_650);
    expect(amount(r, "rounding")).toBe(10);
    expect(r.lines.reduce((s, l) => s + l.amount, 0)).toBe(r.total);
  });

  it("同じ入力なら同じ結果になる(決定的)", () => {
    expect(calculateQuote(base, rates)).toEqual(calculateQuote(structuredClone(base), rates));
  });

  it("材料費は最低材料費を下回らない", () => {
    const r = calculateQuote({ ...base, quantity: 1 }, rates);
    const line = r.lines.find((l) => l.kind === "material")!;
    expect(line.amount).toBe(1000);
    expect(line.basis).toContain("最低材料費");
  });

  it("数量係数(量産効果)を加工時間に掛ける。段取りはロットに1回", () => {
    expect(quantityFactor(9, rates)).toBe(1);
    expect(quantityFactor(10, rates)).toBe(0.9);
    const r = calculateQuote({ ...base, quantity: 10 }, rates);
    // 0.5h×0.9×10個×8,000円 = 36,000円
    expect(amount(r, "process")).toBe(36_000);
    expect(amount(r, "setup")).toBe(6000);
    expect(r.hoursPerPiece).toBe(0.45);
  });

  it("外注費は重量単価・個数単価で計算し、最低ロット料金を下回らない", () => {
    const r = calculateQuote(
      {
        ...base,
        treatments: [
          { treatmentId: "plating", unitPriceOverride: null },
          { treatmentId: "hardening", unitPriceOverride: null },
        ],
      },
      rates,
    );
    const [plating, hardening] = r.lines.filter((l) => l.kind === "treatment");
    // めっき 1,000円/kg×1kg×5個 = 5,000円(最低ロット料金と同額)
    expect(plating.amount).toBe(5000);
    // 焼入れ 300円×5個 = 1,500円 → 最低ロット料金 2,000円
    expect(hardening.amount).toBe(2000);
    expect(hardening.basis).toContain("最低ロット料金");
    expect(r.standardLeadDays).toBe(5 + 5 + 3);
  });

  it("特急料金は(加工費+段取り費)×割増率", () => {
    const r = calculateQuote({ ...base, expedite: true }, rates);
    expect(amount(r, "expedite")).toBe(Math.round(26_000 * 0.25));
  });

  it("人が変えた単価・チャージ・利益率を使い、変えた明細に印をつける", () => {
    const r = calculateQuote(
      {
        ...base,
        material: { ...base.material, pricePerKgOverride: 400 },
        processes: [{ ...base.processes[0], chargeOverride: 10_000 }],
        profitRate: 0.1,
      },
      rates,
    );
    expect(amount(r, "material")).toBe(2000);
    expect(amount(r, "process")).toBe(25_000);
    expect(r.lines.find((l) => l.kind === "material")!.overridden).toBe(true);
    expect(r.lines.find((l) => l.kind === "profit")!.overridden).toBe(true);
  });

  it("数量段階ごとの単価を同じ式で計算し、少量ほど単価が高い", () => {
    const r = calculateQuote(base, rates);
    expect(r.tiers.map((t) => t.quantity)).toEqual([1, 5, 10]);
    expect(r.tiers.find((t) => t.quantity === 5)!.unitPrice).toBe(r.unitPrice);
    const prices = r.tiers.map((t) => t.unitPrice);
    expect(prices).toEqual([...prices].sort((a, b) => b - a));
    expect(r.tiers[0].unitPrice).toBe(calculateQuote({ ...base, quantity: 1 }, rates).unitPrice);
  });

  it("単価表にない材質・工程・処理はエラー", () => {
    expect(() => calculateQuote({ ...base, material: { ...base.material, materialId: "XX" } }, rates)).toThrow(QuoteInputError);
    expect(() => calculateQuote({ ...base, processes: [{ ...base.processes[0], processId: "xx" }] }, rates)).toThrow(QuoteInputError);
    expect(() => calculateQuote({ ...base, treatments: [{ treatmentId: "xx", unitPriceOverride: null }] }, rates)).toThrow(QuoteInputError);
  });

  it("工程の出典(過去案件id)を明細の参照に残す", () => {
    const r = calculateQuote(base, rates);
    expect(r.lines.find((l) => l.kind === "process")!.ref).toEqual({
      type: "process",
      id: "mc",
      caseIds: ["Q-1"],
      sourceKind: "ai",
    });
  });
});

describe("重量と標準リードタイム", () => {
  it("丸物は取り代を足した円柱の重量", () => {
    // φ(10+3)×(100+5) → π×6.5²×105 = 13,937mm³ ≒ 13.937cm³ × 8 = 0.111kg
    const w = blankWeightKg({ shape: "round", lengthMm: 100, widthMm: null, heightMm: null, diameterMm: 10 }, 8, rates);
    expect(w).toBeCloseTo(0.111, 3);
  });

  it("仕上がり重量は取り代を含まない", () => {
    expect(partWeightKg(base.material.dimensions, 8)).toBe(1);
  });

  it("数量50個ごとに1日、外注の日数を足す", () => {
    expect(standardLeadDays({ ...base, quantity: 50 }, rates)).toBe(5);
    expect(standardLeadDays({ ...base, quantity: 51 }, rates)).toBe(6);
  });
});
