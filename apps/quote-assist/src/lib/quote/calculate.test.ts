import { beforeAll, describe, expect, it } from "vitest";
import type { RateTable } from "../domain/reference";
import { loadReferenceData } from "../reference/load";
import { DATA_DIR } from "../test-helpers";
import { blankWeightKg, calculateQuote, partWeightKg, quantityFactor, QuoteInputError, standardLeadDays } from "./calculate";
import type { QuoteInput, QuoteProcessInput } from "./types";

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

const proc = (processId: string, setupHours: number, cycleHoursPerPiece: number, chargeOverride: number | null = null): QuoteProcessInput => ({
  processId,
  setupHours,
  cycleHoursPerPiece,
  chargeOverride,
  source: { kind: "ai", caseIds: [], note: null },
});

describe("手計算での検算(合成データの単価表 RT-2026-09)", () => {
  let real: RateTable;
  beforeAll(async () => {
    real = (await loadReferenceData(DATA_DIR)).rates;
  });

  // SUS304 角物 120×60×25mm、50個、マシニング(段取り1h・1個1.2h)+検査(0.5h・0.1h)、無電解ニッケルめっき、利益15%
  const input = (): QuoteInput => ({
    quantity: 50,
    material: {
      materialId: "SUS304",
      dimensions: { shape: "block", lengthMm: 120, widthMm: 60, heightMm: 25, diameterMm: null },
      pricePerKgOverride: null,
    },
    processes: [proc("mc", 1, 1.2), proc("inspection", 0.5, 0.1)],
    treatments: [{ treatmentId: "electroless_ni", unitPriceOverride: null }],
    profitRate: 0.15,
    expedite: false,
  });

  it("各明細・合計・単価が手計算と一致する", () => {
    const r = calculateQuote(input(), real);
    // 素材 (120+5)×(60+5)×(25+3) = 227,500mm³ × 7.93 ÷ 1,000,000 = 1.804075 → 1.804kg
    expect(r.weightKgPerPiece).toBe(1.804);
    // 仕上がり 120×60×25 = 180,000mm³ × 7.93 ÷ 1,000,000 = 1.4274 → 1.427kg
    expect(r.partWeightKgPerPiece).toBe(1.427);
    expect(r.lines.map((l) => [l.label, l.basis, l.amount])).toEqual([
      ["材料費(SUS304)", "1.804kg × 50個 × 750円/kg", 67_650],
      // 50個は数量係数0.9
      ["加工費(マシニング加工)", "1.2h × 数量係数0.9 × 50個 × 8,000円/h", 432_000],
      ["段取り費(マシニング加工)", "1h × 6,000円/h(ロットに1回)", 6_000],
      ["加工費(検査)", "0.1h × 数量係数0.9 × 50個 × 6,000円/h", 27_000],
      ["段取り費(検査)", "0.5h × 5,000円/h(ロットに1回)", 2_500],
      // 1,200円/kg × 1.427kg × 50個 = 85,620円(最低ロット料金12,000円を超える)
      ["表面処理(無電解ニッケルめっき・外注)", "1,200円/kg × 仕上がり1.427kg × 50個", 85_620],
      // 直接原価 67,650+432,000+6,000+27,000+2,500+85,620 = 620,770 × 12% = 74,492.4 → 74,492
      ["管理費", "直接原価 620,770円 × 12%", 74_492],
      // (620,770+74,492) × 15% = 104,289.3 → 104,289
      ["利益", "(直接原価+管理費)695,262円 × 15%", 104_289],
      // 799,551 ÷ 50 = 15,991.02 → 10円単位に切り上げて16,000円 × 50個 = 800,000円(+449円)
      ["端数調整", "単価を10円単位に切り上げ(16,000円 × 50個)", 449],
    ]);
    expect(r).toMatchObject({ directCost: 620_770, overhead: 74_492, profit: 104_289, rawTotal: 799_551, unitPrice: 16_000, total: 800_000 });
    // 標準リードタイム 基本5日 + 数量加算0日(50個まで)+ めっき5日
    expect(r.standardLeadDays).toBe(10);
  });

  it("数量1個は最低材料費・最低ロット料金が効き、段取りを1個で負担する", () => {
    const r = calculateQuote({ ...input(), quantity: 1 }, real);
    // 材料 1.804kg×1×750 = 1,353円 → 最低材料費2,000円
    expect(r.lines[0]).toMatchObject({ amount: 2_000, basis: "最低材料費 2,000円(1.804kg × 1個 × 750円/kg = 1,353円)" });
    // めっき 1,200×1.427×1 = 1,712.4 → 1,712円 → 最低ロット料金12,000円
    expect(r.lines.find((l) => l.kind === "treatment")!.amount).toBe(12_000);
    // 直接原価 2,000 + (9,600+6,000+600+2,500) + 12,000 = 32,700、管理費3,924、利益 36,624×15% = 5,493.6 → 5,494
    expect(r).toMatchObject({ directCost: 32_700, overhead: 3_924, profit: 5_494, rawTotal: 42_118, unitPrice: 42_120 });
    expect(r.tiers.find((t) => t.quantity === 1)!.unitPrice).toBe(42_120);
  });

  it("特急料金は(加工費+段取り費)× 25% を直接原価に入れる", () => {
    const r = calculateQuote({ ...input(), expedite: true }, real);
    // (432,000+6,000+27,000+2,500) × 25% = 116,875
    expect(r.lines.find((l) => l.kind === "expedite")).toMatchObject({ amount: 116_875, basis: "(加工費+段取り費)467,500円 × 25%" });
    expect(r.directCost).toBe(620_770 + 116_875);
  });
});

describe("浮動小数点の誤差で1円ずれない(手計算でちょうど0.5円になる明細)", () => {
  const variant: RateTable = {
    ...rates,
    processes: [{ id: "mc", name: "マシニング加工", chargePerHour: 6500, setupChargePerHour: 6000, types: ["milling"] }],
    materials: [{ ...rates.materials[0], minChargePerLot: 0 }],
    rules: { ...rates.rules, quantityBreaks: [{ minQty: 1, factor: 1 }, { minQty: 10, factor: 0.95 }] },
  };

  it("0.01h × 数量係数0.95 × 30個 × 6,500円/h = 1,852.5円 → 1,853円(Math.round だと1,852円)", () => {
    expect(Math.round(0.01 * 0.95 * 30 * 6500)).toBe(1852);
    const r = calculateQuote({ ...base, quantity: 30, processes: [proc("mc", 0, 0.01)] }, variant);
    expect(r.lines.find((l) => l.kind === "process")).toMatchObject({ amount: 1853, basis: "0.01h × 数量係数0.95 × 30個 × 6,500円/h" });
  });

  it("材料 0.009kg × 1個 × 1,500円/kg = 13.5円 → 14円(Math.round だと13円)", () => {
    expect(Math.round(0.009 * 1 * 1500)).toBe(13);
    // 15×15×5mm = 1,125mm³ × 8g/cm³ ÷ 1,000,000 = 0.009kg(テスト用の単価表は取り代0)
    const dims = { shape: "block" as const, lengthMm: 15, widthMm: 15, heightMm: 5, diameterMm: null };
    const r = calculateQuote({ ...base, quantity: 1, material: { materialId: "SS400", dimensions: dims, pricePerKgOverride: 1500 } }, variant);
    expect(r.lines[0]).toMatchObject({ amount: 14, basis: "0.009kg × 1個 × 1,500円/kg" });
  });

  it("重量の四捨五入もちょうど0.5gで切り上げる(12.5×15×15mm × 8 = 0.0225kg → 0.023kg)", () => {
    const dims = { shape: "block" as const, lengthMm: 12.5, widthMm: 15, heightMm: 15, diameterMm: null };
    expect(blankWeightKg(dims, 8, rates)).toBe(0.023);
    expect(partWeightKg(dims, 8)).toBe(0.023);
  });

  it("寸法に小数があっても、取り代を足した値は10進で正確(100.1+5 = 105.1)", () => {
    const allowance = { ...rates, rules: { ...rates.rules, blankAllowanceMm: { ...rates.rules.blankAllowanceMm, block: { lengthMm: 5, widthMm: 0.2, heightMm: 0, diameterMm: 0 } } } };
    // 105.1 × 10.3 × 10 = 10,825.3mm³ × 8 ÷ 1,000,000 = 0.0866024 → 0.087kg
    expect(blankWeightKg({ shape: "block", lengthMm: 100.1, widthMm: 10.1, heightMm: 10, diameterMm: null }, 8, allowance)).toBe(0.087);
  });

  it("板物は長さ・幅に取り代、板厚はそのまま(310×210×2mm × 8 = 1.0416kg → 1.042kg)", () => {
    expect(blankWeightKg({ shape: "sheet", lengthMm: 300, widthMm: 200, heightMm: 2, diameterMm: null }, 8, rates)).toBe(1.042);
  });

  it("人が入れた小数の工数・単価は、計算式にも丸めずに出す(手計算で同じ金額になる)", () => {
    const r = calculateQuote(
      { ...base, quantity: 3, processes: [proc("mc", 0.125, 0.333, 6500.5)], material: { ...base.material, pricePerKgOverride: 750.25 } },
      variant,
    );
    // 0.333 × 3 × 6,500.5 = 6,493.9995 → 6,494円
    expect(r.lines.find((l) => l.kind === "process")).toMatchObject({ amount: 6494, basis: "0.333h × 3個 × 6,500.5円/h" });
    // 0.125 × 6,000 = 750円
    expect(r.lines.find((l) => l.kind === "setup")).toMatchObject({ amount: 750, basis: "0.125h × 6,000円/h(ロットに1回)" });
    // 1kg × 3 × 750.25 = 2,250.75 → 2,251円
    expect(r.lines[0]).toMatchObject({ amount: 2251, basis: "1kg × 3個 × 750.25円/kg" });
  });
});

describe("境界値と不正な入力", () => {
  it("数量100,000個でも、金額は整数で、明細の合計が見積金額に一致し、単価は10円単位", () => {
    const r = calculateQuote({ ...base, quantity: 100_000, processes: [proc("mc", 99, 99)], profitRate: 1 }, rates);
    expect(Number.isSafeInteger(r.total)).toBe(true);
    expect(r.lines.every((l) => Number.isInteger(l.amount))).toBe(true);
    expect(r.lines.reduce((s, l) => s + l.amount, 0)).toBe(r.total);
    expect(r.unitPrice % 10).toBe(0);
    // 99h × 0.9 × 100,000個 × 8,000円/h = 71,280,000,000円
    expect(r.lines.find((l) => l.kind === "process")!.amount).toBe(71_280_000_000);
    expect(r.lines.find((l) => l.kind === "process")!.basis).toContain("100,000個");
  });

  it("端数調整は0以上、(10円 × 数量)未満", () => {
    for (const quantity of [1, 3, 7, 9, 10, 11, 49, 50, 99, 101]) {
      const r = calculateQuote({ ...base, quantity }, rates);
      const rounding = r.total - r.rawTotal;
      expect(rounding).toBeGreaterThanOrEqual(0);
      expect(rounding).toBeLessThan(10 * quantity);
      expect(r.lines.reduce((s, l) => s + l.amount, 0)).toBe(r.total);
    }
  });

  it("最低材料費ちょうどのときは重量計算の式を出す(金額は同じ)", () => {
    // 1kg × 5個 × 200円 = 1,000円 = 最低材料費
    const r = calculateQuote(base, rates);
    expect(r.lines[0]).toMatchObject({ amount: 1000, basis: "1kg × 5個 × 200円/kg" });
  });

  it("段取りも加工時間も0の工程は明細を作らない", () => {
    const r = calculateQuote({ ...base, processes: [proc("mc", 0, 0)] }, rates);
    expect(r.lines.filter((l) => l.kind === "process" || l.kind === "setup")).toEqual([]);
  });

  it.each([
    ["数量0", { quantity: 0 }],
    ["負の数量", { quantity: -1 }],
    ["小数の数量", { quantity: 1.5 }],
    ["上限を超える数量", { quantity: 100_001 }],
    ["負の工数", { processes: [proc("mc", -1, 0.5)] }],
    ["NaN の工数", { processes: [proc("mc", 1, Number.NaN)] }],
    ["100%を超える利益率", { profitRate: 1.2 }],
    ["負の利益率", { profitRate: -0.1 }],
    ["0以下の材料単価", { material: { ...base.material, pricePerKgOverride: 0 } }],
    ["寸法が0", { material: { ...base.material, dimensions: { ...base.material.dimensions, heightMm: 0 } } }],
    ["寸法が10m以上", { material: { ...base.material, dimensions: { ...base.material.dimensions, lengthMm: 1e300 } } }],
  ])("%s は計算しない(QuoteInputError)", (_, patch) => {
    expect(() => calculateQuote({ ...base, ...patch } as QuoteInput, rates)).toThrow(QuoteInputError);
  });

  it("同じ工程・同じ表面処理が2回あると二重計上になるので計算しない", () => {
    expect(() => calculateQuote({ ...base, processes: [proc("mc", 1, 0.5), proc("mc", 1, 0.5)] }, rates)).toThrow("工程が重複");
    const twice = [
      { treatmentId: "plating", unitPriceOverride: null },
      { treatmentId: "plating", unitPriceOverride: null },
    ];
    expect(() => calculateQuote({ ...base, treatments: twice }, rates)).toThrow("表面処理・熱処理が重複");
  });
});
