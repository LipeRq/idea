import type {
  Defect,
  Dimensions,
  MaterialGroup,
  PastCase,
  ProcessHours,
  ProcessType,
  RateTable,
  Shape,
} from "../../src/lib/domain/reference";
import { blankWeightKg, calculateQuote } from "../../src/lib/quote/calculate";
import type { QuoteInput } from "../../src/lib/quote/types";
import { addDays } from "../../src/lib/dates";
import { createRandom, roundTo, type Random } from "./random";
import { CUSTOMER_WEIGHTS, customers } from "./masters";

// 過去案件(約200件)の合成。工数は「材質・大きさ・公差・形状特徴」から決まる見積工数に、
// 実績のばらつき(平均で約4%の超過、2割ほどが15%以上の超過=赤字の可能性)を掛けて作る。

type Family = {
  names: string[];
  processType: ProcessType;
  shape: Shape;
  materials: [string, number][];
  dims: (r: Random) => Dimensions;
  features: string[];
  weight: number;
};

const block = (l: number, w: number, h: number): Dimensions => ({
  shape: "block",
  lengthMm: l,
  widthMm: w,
  heightMm: h,
  diameterMm: null,
});
const round = (d: number, l: number): Dimensions => ({
  shape: "round",
  lengthMm: l,
  widthMm: null,
  heightMm: null,
  diameterMm: d,
});
const sheet = (l: number, w: number, t: number): Dimensions => ({
  shape: "sheet",
  lengthMm: l,
  widthMm: w,
  heightMm: t,
  diameterMm: null,
});

const FAMILIES: Family[] = [
  {
    names: ["ブラケット", "センサブラケット", "取付ブラケット", "ガイドブラケット", "ストッパブラケット"],
    processType: "milling",
    shape: "block",
    materials: [["SUS304", 3], ["A5052", 3], ["SS400", 2], ["S45C", 1]],
    dims: (r) => block(r.int(8, 32) * 5, r.int(4, 16) * 5, r.int(8, 40)),
    features: ["φ6H7リーマ穴×2", "M4タップ×4", "M5タップ×4", "M6タップ×2", "長穴加工", "ポケット加工", "段付き加工"],
    weight: 26,
  },
  {
    names: ["ベースプレート", "取付プレート", "カバープレート", "スペーサープレート", "調整プレート"],
    processType: "milling",
    shape: "block",
    materials: [["A5052", 4], ["SS400", 3], ["SUS304", 2], ["A6061", 1]],
    dims: (r) => block(r.int(16, 60) * 5, r.int(10, 40) * 5, r.int(5, 25)),
    features: ["φ9キリ穴×4", "M6タップ×6", "M8タップ×4", "座ぐり加工", "平面度0.05", "長穴加工"],
    weight: 24,
  },
  {
    names: ["ブロック", "ガイドブロック", "位置決めブロック", "クランプブロック", "ジョイントブロック"],
    processType: "milling",
    shape: "block",
    materials: [["S45C", 3], ["SUS304", 2], ["A5052", 2], ["SCM435", 1], ["C3604", 1], ["A7075", 1]],
    dims: (r) => block(r.int(6, 24) * 5, r.int(5, 16) * 5, r.int(20, 60)),
    features: ["φ8H7リーマ穴×2", "M6タップ×4", "段付き加工", "溝加工", "焼入れ後研削"],
    weight: 22,
  },
  {
    names: ["シャフト", "駆動シャフト", "従動シャフト", "ローラシャフト", "ピボットシャフト"],
    processType: "turning",
    shape: "round",
    materials: [["S45C", 4], ["SUS304", 2], ["SCM435", 2], ["SUS303", 1]],
    dims: (r) => round(r.int(4, 20) * 2, r.int(10, 60) * 5),
    features: ["キー溝", "止め輪溝", "ねじ加工M10", "段付き", "センタ穴", "Dカット"],
    weight: 24,
  },
  {
    names: ["カラー", "スペーサー", "ブッシュ", "スリーブ"],
    processType: "turning",
    shape: "round",
    materials: [["SUS304", 2], ["S45C", 2], ["C3604", 2], ["A5052", 1], ["SUS303", 1]],
    dims: (r) => round(r.int(5, 25) * 2, r.int(5, 40)),
    features: ["内径H7", "面取りC0.5", "ローレット"],
    weight: 22,
  },
  {
    names: ["フランジ", "取付フランジ", "軸受フランジ"],
    processType: "turning",
    shape: "round",
    materials: [["SS400", 2], ["SUS304", 2], ["S45C", 1]],
    dims: (r) => round(r.int(10, 30) * 5, r.int(10, 30)),
    features: ["PCD穴×4", "インロー", "Oリング溝"],
    weight: 12,
  },
  {
    names: ["ピン", "位置決めピン", "ガイドピン", "ノックピン"],
    processType: "turning",
    shape: "round",
    materials: [["SUS304", 2], ["S45C", 2], ["SCM435", 1]],
    dims: (r) => round(r.int(3, 16), r.int(2, 12) * 5),
    features: ["先端R", "止め輪溝", "焼入れ後研削"],
    weight: 14,
  },
  {
    names: ["カバー", "安全カバー", "配線カバー"],
    processType: "sheet",
    shape: "sheet",
    materials: [["SPCC", 3], ["SUS304", 2], ["A5052", 1]],
    dims: (r) => sheet(r.int(10, 40) * 10, r.int(8, 30) * 10, r.pick([1, 1.6, 2, 3])),
    features: ["曲げ4か所", "曲げ2か所", "穴あけ×8", "切り欠き"],
    weight: 18,
  },
  {
    names: ["L字ブラケット", "アングル", "取付金具"],
    processType: "sheet",
    shape: "sheet",
    materials: [["SPCC", 2], ["SUS304", 2], ["SS400", 1]],
    dims: (r) => sheet(r.int(5, 20) * 10, r.int(3, 10) * 10, r.pick([2, 3, 4])),
    features: ["曲げ1か所", "曲げ2か所", "長穴×2", "穴あけ×4"],
    weight: 14,
  },
];

const MACHINABILITY: Record<string, number> = {
  SS400: 1, S45C: 1.05, SCM435: 1.15, SPCC: 1, SUS304: 1.35, SUS303: 1.2,
  A5052: 0.7, A6061: 0.7, A7075: 0.75, C3604: 0.6,
};

const toleranceFactor = (t: number) => (t <= 0.005 ? 1.5 : t <= 0.01 ? 1.35 : t <= 0.02 ? 1.15 : 1);

function volumeCm3(d: Dimensions): number {
  if (d.shape === "round") return (Math.PI * ((d.diameterMm ?? 0) / 2) ** 2 * d.lengthMm) / 1000;
  return (d.lengthMm * (d.widthMm ?? 0) * (d.heightMm ?? 0)) / 1000;
}

const cyc = (h: number) => Math.max(0.05, roundTo(h, 0.05));
const setup = (h: number) => roundTo(h, 0.25);

/** 図面の条件から見積工数(工程ごと)を決める */
export function estimateHours(
  processType: ProcessType,
  dims: Dimensions,
  materialId: string,
  toleranceMm: number,
  features: string[],
): ProcessHours[] {
  const mf = MACHINABILITY[materialId] ?? 1;
  const tf = toleranceFactor(toleranceMm);
  const ff = 1 + 0.08 * features.length;
  const v = volumeCm3(dims);
  const tight = toleranceMm <= 0.01;
  const has = (word: string) => features.some((f) => f.includes(word));
  const out: ProcessHours[] = [];
  const inspection = {
    processId: "inspection",
    setupHours: tight ? 0.5 : 0.25,
    cycleHoursPerPiece: cyc(tight ? 0.1 + 0.01 * features.length : 0.05),
  };

  if (processType === "milling") {
    out.push({
      processId: "mc",
      setupHours: setup(0.5 + 0.25 * Math.min(3, features.length) + (tight ? 0.25 : 0)),
      cycleHoursPerPiece: cyc((0.15 + 0.012 * v ** 0.6) * mf * tf * ff),
    });
    if (toleranceMm <= 0.005 || has("平面度") || has("研削")) {
      out.push({ processId: "grinding", setupHours: 0.5, cycleHoursPerPiece: cyc(0.2 + 0.02 * v ** 0.4) });
    }
    out.push({ processId: "deburr", setupHours: 0, cycleHoursPerPiece: cyc(0.05 + 0.0008 * v ** 0.8) });
    out.push(inspection);
  } else if (processType === "turning") {
    out.push({
      processId: "lathe",
      setupHours: setup(0.5 + 0.25 * Math.min(2, features.length)),
      cycleHoursPerPiece: cyc((0.08 + 0.012 * v ** 0.6) * mf * tf * ff),
    });
    const millingFeatures = features.filter((f) => /キー溝|Dカット|PCD|穴/.test(f) && !f.includes("センタ穴")).length;
    if (millingFeatures > 0) {
      out.push({ processId: "mc", setupHours: 0.5, cycleHoursPerPiece: cyc(0.1 + 0.05 * millingFeatures) });
    }
    if (toleranceMm <= 0.005 || has("研削")) {
      out.push({ processId: "cyl_grinding", setupHours: 0.5, cycleHoursPerPiece: cyc(0.15 + 0.0005 * dims.lengthMm) });
    }
    out.push({ processId: "deburr", setupHours: 0, cycleHoursPerPiece: 0.05 });
    out.push(inspection);
  } else {
    const area = (dims.lengthMm * (dims.widthMm ?? 0)) / 100;
    const bends = Number(features.join(" ").match(/曲げ(\d)/)?.[1] ?? 2);
    out.push({ processId: "laser", setupHours: 0.25, cycleHoursPerPiece: cyc(0.03 + 0.0002 * area ** 0.9) });
    out.push({ processId: "bending", setupHours: 0.5, cycleHoursPerPiece: cyc(0.03 * bends * mf) });
    out.push({ processId: "deburr", setupHours: 0, cycleHoursPerPiece: 0.05 });
    out.push({ ...inspection, setupHours: 0.25, cycleHoursPerPiece: 0.05 });
  }
  return out;
}

function pickTolerance(r: Random, processType: ProcessType): number {
  if (processType === "milling") return r.weighted([[0.01, 20], [0.02, 25], [0.05, 30], [0.1, 25]]);
  if (processType === "turning") return r.weighted([[0.005, 15], [0.01, 25], [0.02, 25], [0.05, 20], [0.1, 15]]);
  return r.weighted([[0.1, 60], [0.2, 40]]);
}

function pickSurface(r: Random, group: MaterialGroup, processType: ProcessType): string | null {
  if (group === "stainless") return r.weighted([[null, 85], ["electroless_ni", 15]]);
  if (group === "aluminum") {
    return r.weighted([["white_anodize", 35], ["black_anodize", 20], ["hard_anodize", 15], [null, 30]]);
  }
  if (group === "copper") return r.weighted([[null, 80], ["electroless_ni", 20]]);
  if (processType === "sheet") return r.weighted([["trivalent_chromate", 40], [null, 60]]);
  return r.weighted([["black_oxide", 30], ["trivalent_chromate", 20], ["electroless_ni", 15], [null, 35]]);
}

function pickHeat(r: Random, materialId: string, processType: ProcessType): string | null {
  if (materialId !== "S45C" && materialId !== "SCM435") return null;
  if (processType === "turning") return r.weighted([["induction_hardening", 20], ["quench_temper", 15], [null, 65]]);
  return r.weighted([["quench_temper", 20], [null, 80]]);
}

function actualOf(r: Random, estimated: ProcessHours[], bias: number): ProcessHours[] {
  const caseFactor = Math.exp(r.normal(0.04 + bias, 0.12));
  return estimated.map((p) => ({
    processId: p.processId,
    setupHours: roundTo(p.setupHours * Math.exp(r.normal(0.02, 0.1)), 0.05),
    cycleHoursPerPiece: Math.max(0.01, roundTo(p.cycleHoursPerPiece * caseFactor * Math.exp(r.normal(0, 0.04)), 0.01)),
  }));
}

function weekday(r: Random, from: string, to: string): string {
  const span = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  for (;;) {
    const d = addDays(from, r.int(0, span));
    const day = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (day !== 0 && day !== 6) return d;
  }
}

type Draft = Omit<PastCase, "id" | "weightKg" | "unitPrice" | "amount" | "defectIds"> & {
  profitRate: number;
  expedite: boolean;
  fixedDefect?: Omit<Defect, "id" | "caseId" | "drawingNumber">;
  // デモ用に固定した案件。リピートの元にはしない
  fixed?: boolean;
};

// デモで類似案件として出したい過去案件(use-cases.md 5.6 の 1:30〜2:30)
function fixedDrafts(): Draft[] {
  const common = { profitRate: 0.15, expedite: false, lostReason: null, fixed: true };
  return [
    {
      ...common,
      quotedAt: "2025-06-12",
      customerId: "C01",
      drawingNumber: "MS-24017",
      revision: "B",
      partName: "センサブラケット",
      processType: "milling",
      dimensions: block(120, 60, 25),
      materialId: "SUS304",
      toleranceMm: 0.01,
      surfaceTreatmentId: "electroless_ni",
      heatTreatmentId: null,
      features: ["φ8H7リーマ穴×2(ピッチ85±0.01)", "M5タップ×4 深さ10", "ポケット30×20 深さ10"],
      notes: "めっき後寸法でφ8H7を保証。初回はめっき膜厚の見込みで手直しが発生",
      quantity: 30,
      estimatedProcesses: [
        { processId: "mc", setupHours: 1, cycleHoursPerPiece: 1 },
        { processId: "deburr", setupHours: 0, cycleHoursPerPiece: 0.1 },
        { processId: "inspection", setupHours: 0.5, cycleHoursPerPiece: 0.1 },
      ],
      actualProcesses: [
        { processId: "mc", setupHours: 1.25, cycleHoursPerPiece: 1.35 },
        { processId: "deburr", setupHours: 0, cycleHoursPerPiece: 0.13 },
        { processId: "inspection", setupHours: 0.5, cycleHoursPerPiece: 0.12 },
      ],
      result: "won",
      responseDays: 4,
      fixedDefect: {
        date: "2025-07-18",
        category: "寸法不良(めっき後)",
        description: "めっき後にφ8H7穴が公差下限を外れた(膜厚の見込み不足)。30個中6個を手直し",
        countermeasure: "めっき前の穴径を膜厚分大きく仕上げるよう工程表に明記",
      },
    },
    {
      ...common,
      quotedAt: "2025-11-05",
      customerId: "C01",
      drawingNumber: "MS-24102",
      revision: "A",
      partName: "センサ取付プレート",
      processType: "milling",
      dimensions: block(110, 55, 20),
      materialId: "SUS304",
      toleranceMm: 0.02,
      surfaceTreatmentId: "electroless_ni",
      heatTreatmentId: null,
      features: ["φ6H7リーマ穴×2", "M4タップ×4"],
      notes: "",
      quantity: 40,
      estimatedProcesses: [
        { processId: "mc", setupHours: 0.75, cycleHoursPerPiece: 0.8 },
        { processId: "deburr", setupHours: 0, cycleHoursPerPiece: 0.1 },
        { processId: "inspection", setupHours: 0.25, cycleHoursPerPiece: 0.05 },
      ],
      actualProcesses: [
        { processId: "mc", setupHours: 0.75, cycleHoursPerPiece: 0.82 },
        { processId: "deburr", setupHours: 0, cycleHoursPerPiece: 0.1 },
        { processId: "inspection", setupHours: 0.25, cycleHoursPerPiece: 0.05 },
      ],
      result: "won",
      responseDays: 3,
    },
    {
      ...common,
      quotedAt: "2026-01-20",
      customerId: "C05",
      drawingNumber: "SK-1188",
      revision: "A",
      partName: "ガイドブラケット",
      processType: "milling",
      dimensions: block(130, 65, 28),
      materialId: "SUS304",
      toleranceMm: 0.01,
      surfaceTreatmentId: null,
      heatTreatmentId: null,
      features: ["φ8H7リーマ穴×2", "M6タップ×4", "段付き加工"],
      notes: "",
      quantity: 20,
      estimatedProcesses: [
        { processId: "mc", setupHours: 1, cycleHoursPerPiece: 1.1 },
        { processId: "deburr", setupHours: 0, cycleHoursPerPiece: 0.1 },
        { processId: "inspection", setupHours: 0.5, cycleHoursPerPiece: 0.1 },
      ],
      actualProcesses: null,
      result: "lost",
      lostReason: "価格(他社より高い)",
      responseDays: 5,
    },
    {
      ...common,
      quotedAt: "2025-02-20",
      customerId: "C05",
      drawingNumber: "SK-5521",
      revision: "A",
      partName: "駆動シャフト",
      processType: "turning",
      dimensions: round(20, 180),
      materialId: "S45C",
      toleranceMm: 0.005,
      surfaceTreatmentId: "black_oxide",
      heatTreatmentId: "induction_hardening",
      features: ["φ20±0.005 軸受部×2", "キー溝 6×3.5×25", "段付き φ18"],
      notes: "高周波焼入れ後に軸受部を円筒研削",
      quantity: 6,
      estimatedProcesses: [
        { processId: "lathe", setupHours: 0.75, cycleHoursPerPiece: 0.35 },
        { processId: "mc", setupHours: 0.5, cycleHoursPerPiece: 0.15 },
        { processId: "cyl_grinding", setupHours: 0.5, cycleHoursPerPiece: 0.25 },
        { processId: "deburr", setupHours: 0, cycleHoursPerPiece: 0.05 },
        { processId: "inspection", setupHours: 0.5, cycleHoursPerPiece: 0.1 },
      ],
      actualProcesses: [
        { processId: "lathe", setupHours: 0.75, cycleHoursPerPiece: 0.37 },
        { processId: "mc", setupHours: 0.5, cycleHoursPerPiece: 0.16 },
        { processId: "cyl_grinding", setupHours: 0.5, cycleHoursPerPiece: 0.27 },
        { processId: "deburr", setupHours: 0, cycleHoursPerPiece: 0.05 },
        { processId: "inspection", setupHours: 0.5, cycleHoursPerPiece: 0.1 },
      ],
      result: "won",
      responseDays: 2,
    },
    {
      ...common,
      quotedAt: "2025-09-10",
      customerId: "C05",
      drawingNumber: "SK-4410",
      revision: "A",
      partName: "従動シャフト",
      processType: "turning",
      dimensions: round(20, 160),
      materialId: "S45C",
      toleranceMm: 0.01,
      surfaceTreatmentId: "black_oxide",
      heatTreatmentId: "induction_hardening",
      features: ["キー溝", "止め輪溝"],
      notes: "",
      quantity: 10,
      estimatedProcesses: [
        { processId: "lathe", setupHours: 0.75, cycleHoursPerPiece: 0.3 },
        { processId: "mc", setupHours: 0.5, cycleHoursPerPiece: 0.15 },
        { processId: "deburr", setupHours: 0, cycleHoursPerPiece: 0.05 },
        { processId: "inspection", setupHours: 0.5, cycleHoursPerPiece: 0.1 },
      ],
      actualProcesses: [
        { processId: "lathe", setupHours: 0.75, cycleHoursPerPiece: 0.32 },
        { processId: "mc", setupHours: 0.5, cycleHoursPerPiece: 0.15 },
        { processId: "deburr", setupHours: 0, cycleHoursPerPiece: 0.05 },
        { processId: "inspection", setupHours: 0.5, cycleHoursPerPiece: 0.1 },
      ],
      result: "won",
      responseDays: 3,
    },
    {
      ...common,
      quotedAt: "2026-03-04",
      customerId: "C02",
      drawingNumber: "MZ-2201",
      revision: "B",
      partName: "ベースプレート",
      processType: "milling",
      dimensions: block(200, 150, 12),
      materialId: "A5052",
      toleranceMm: 0.05,
      surfaceTreatmentId: "white_anodize",
      heatTreatmentId: null,
      features: ["φ9キリ穴×4", "M6タップ×6", "平面度0.05"],
      notes: "",
      quantity: 5,
      estimatedProcesses: [
        { processId: "mc", setupHours: 1, cycleHoursPerPiece: 0.55 },
        { processId: "grinding", setupHours: 0.5, cycleHoursPerPiece: 0.3 },
        { processId: "deburr", setupHours: 0, cycleHoursPerPiece: 0.1 },
        { processId: "inspection", setupHours: 0.25, cycleHoursPerPiece: 0.05 },
      ],
      actualProcesses: [
        { processId: "mc", setupHours: 1, cycleHoursPerPiece: 0.6 },
        { processId: "grinding", setupHours: 0.5, cycleHoursPerPiece: 0.3 },
        { processId: "deburr", setupHours: 0, cycleHoursPerPiece: 0.1 },
        { processId: "inspection", setupHours: 0.25, cycleHoursPerPiece: 0.05 },
      ],
      result: "won",
      responseDays: 2,
    },
    {
      ...common,
      quotedAt: "2026-05-19",
      customerId: "C08",
      drawingNumber: "KS-6120",
      revision: "A",
      partName: "取付プレート",
      processType: "milling",
      dimensions: block(180, 140, 10),
      materialId: "A5052",
      toleranceMm: 0.05,
      surfaceTreatmentId: "black_anodize",
      heatTreatmentId: null,
      features: ["φ9キリ穴×4", "座ぐり加工"],
      notes: "",
      quantity: 3,
      estimatedProcesses: [
        { processId: "mc", setupHours: 1, cycleHoursPerPiece: 0.45 },
        { processId: "deburr", setupHours: 0, cycleHoursPerPiece: 0.1 },
        { processId: "inspection", setupHours: 0.25, cycleHoursPerPiece: 0.05 },
      ],
      actualProcesses: null,
      result: "lost",
      lostReason: "納期が合わない",
      responseDays: 6,
    },
  ];
}

function randomDraft(r: Random, usedNumbers: Map<string, Draft>, previous: Draft[]): Draft {
  const customerId = r.weighted(Object.entries(CUSTOMER_WEIGHTS));
  const customer = customers.find((c) => c.id === customerId)!;
  const quotedAt = weekday(r, "2024-04-01", "2026-09-30");

  // 1割弱はリピート(同じ図番の再見積・改訂)
  const repeatFrom = previous.filter((d) => d.customerId === customerId && !d.fixed);
  if (repeatFrom.length > 0 && r.chance(0.08)) {
    const base = r.pick(repeatFrom);
    const later = addDays(base.quotedAt, r.int(60, 400));
    const inRange = later <= "2026-09-30";
    const revision =
      inRange && r.chance(0.5) ? String.fromCharCode(base.revision.charCodeAt(0) + 1) : base.revision;
    return withOutcome(r, { ...base, quotedAt: inRange ? later : base.quotedAt, revision, quantity: pickQuantity(r) });
  }

  const family = r.weighted(FAMILIES.map((f) => [f, f.weight] as const));
  const materialId = r.weighted(family.materials);
  const dimensions = family.dims(r);
  const toleranceMm = pickTolerance(r, family.processType);
  const features = r.sample(family.features, r.int(1, Math.min(3, family.features.length)));
  const group = materialGroup(materialId);
  let drawingNumber: string;
  do {
    drawingNumber = `${customer.drawingPrefix}-${quotedAt.slice(2, 4)}${String(r.int(1, 999)).padStart(3, "0")}`;
  } while (usedNumbers.has(drawingNumber));

  const draft: Draft = {
    quotedAt,
    customerId,
    drawingNumber,
    revision: r.weighted([["A", 55], ["B", 30], ["C", 12], ["D", 3]]),
    partName: r.pick(family.names),
    processType: family.processType,
    dimensions,
    materialId,
    toleranceMm,
    surfaceTreatmentId: pickSurface(r, group, family.processType),
    heatTreatmentId: pickHeat(r, materialId, family.processType),
    features,
    notes: "",
    quantity: pickQuantity(r),
    estimatedProcesses: estimateHours(family.processType, dimensions, materialId, toleranceMm, features),
    actualProcesses: null,
    result: "pending",
    lostReason: null,
    responseDays: 0,
    profitRate: r.pick([0.12, 0.15, 0.15, 0.18]),
    expedite: r.chance(0.08),
  };
  return withOutcome(r, draft);
}

function withOutcome(r: Random, draft: Draft): Draft {
  const recent = draft.quotedAt >= "2026-08-15";
  const result = recent && r.chance(0.6) ? "pending" : r.chance(0.5) ? "won" : "lost";
  const tightStainless = draft.toleranceMm <= 0.01 && materialGroup(draft.materialId) === "stainless";
  return {
    ...draft,
    result,
    lostReason:
      result === "lost"
        ? r.weighted([["価格(他社より高い)", 45], ["納期が合わない", 20], ["他社に決定(理由不明)", 25], ["案件自体が中止", 10]])
        : null,
    actualProcesses: result === "won" ? actualOf(r, draft.estimatedProcesses, tightStainless ? 0.06 : 0) : null,
    responseDays: r.weighted([[1, 10], [2, 22], [3, 28], [4, 20], [5, 12], [6, 8]]),
  };
}

function pickQuantity(r: Random): number {
  return r.weighted([[1, 10], [2, 8], [3, 8], [5, 12], [10, 16], [20, 14], [30, 10], [50, 10], [100, 8], [200, 4]]);
}

let rateTableForGroups: RateTable | null = null;
function materialGroup(materialId: string): MaterialGroup {
  return rateTableForGroups!.materials.find((m) => m.id === materialId)!.group;
}

const DEFECT_TEMPLATES: [string, string, string][] = [
  ["寸法不良", "リーマ穴が公差上限を超えた(工具摩耗)", "工具交換の基準を加工個数で管理"],
  ["めっき不良", "めっきのムラ・密着不良が発生", "前処理(脱脂)の条件を外注先と再確認"],
  ["キズ・打痕", "搬送時に打痕が発生", "仕切り付きの通い箱に変更"],
  ["熱処理変形", "焼入れ後に曲がりが0.1mm発生", "焼入れ後に矯正工程を追加"],
  ["ねじ不良", "タップ穴のねじゲージ不合格", "タップの下穴径を見直し"],
  ["寸法不良", "段付き部の長さが公差外れ", "測定頻度を初品+10個ごとに変更"],
  ["外観不良", "アルマイトの色ムラ", "同一ロットでの処理を外注先に指示"],
  ["寸法不良", "平面度が規格外(クランプひずみ)", "クランプ位置と締め付けトルクを標準化"],
  ["キズ・打痕", "バリ取り時の線キズ", "仕上げ用の治具を作成"],
];

export function generatePastCases(rates: RateTable, total = 200, seed = 20261018) {
  rateTableForGroups = rates;
  const r = createRandom(seed);
  const drafts = fixedDrafts();
  const used = new Map(drafts.map((d) => [d.drawingNumber, d]));
  while (drafts.length < total) {
    const d = randomDraft(r, used, drafts);
    used.set(d.drawingNumber, d);
    drafts.push(d);
  }
  drafts.sort((a, b) => a.quotedAt.localeCompare(b.quotedAt) || a.drawingNumber.localeCompare(b.drawingNumber));

  const seqByYear = new Map<string, number>();
  const cases: PastCase[] = [];
  const defects: Defect[] = [];
  for (const d of drafts) {
    const year = d.quotedAt.slice(0, 4);
    const seq = (seqByYear.get(year) ?? 100) + r.int(1, 4);
    seqByYear.set(year, seq);
    const id = `Q-${year}-${String(seq).padStart(4, "0")}`;
    const material = rates.materials.find((m) => m.id === d.materialId)!;
    const input: QuoteInput = {
      quantity: d.quantity,
      material: { materialId: d.materialId, dimensions: d.dimensions, pricePerKgOverride: null },
      processes: d.estimatedProcesses.map((p) => ({
        ...p,
        chargeOverride: null,
        source: { kind: "human", caseIds: [], note: null },
      })),
      treatments: [d.surfaceTreatmentId, d.heatTreatmentId]
        .filter((t): t is string => t !== null)
        .map((treatmentId) => ({ treatmentId, unitPriceOverride: null })),
      profitRate: d.profitRate,
      expedite: d.expedite,
    };
    const quote = calculateQuote(input, rates);
    const defectIds: string[] = [];
    if (d.fixedDefect) {
      const defectId = `D-${String(defects.length + 1).padStart(3, "0")}`;
      defects.push({ id: defectId, caseId: id, drawingNumber: d.drawingNumber, ...d.fixedDefect });
      defectIds.push(defectId);
    }
    cases.push({
      id,
      quotedAt: d.quotedAt,
      customerId: d.customerId,
      drawingNumber: d.drawingNumber,
      revision: d.revision,
      partName: d.partName,
      processType: d.processType,
      dimensions: d.dimensions,
      materialId: d.materialId,
      weightKg: Math.max(0.001, blankWeightKg(d.dimensions, material.densityGPerCm3, rates)),
      toleranceMm: d.toleranceMm,
      surfaceTreatmentId: d.surfaceTreatmentId,
      heatTreatmentId: d.heatTreatmentId,
      features: d.features,
      notes: d.notes,
      quantity: d.quantity,
      estimatedProcesses: d.estimatedProcesses,
      actualProcesses: d.actualProcesses,
      unitPrice: quote.unitPrice,
      amount: quote.total,
      result: d.result,
      lostReason: d.lostReason,
      responseDays: d.responseDays,
      defectIds,
    });
  }

  // 残りの不具合は、受注して製作した案件に割り当てる
  const wonCases = cases.filter((c) => c.result === "won" && c.defectIds.length === 0);
  for (const [i, c] of r.sample(wonCases, DEFECT_TEMPLATES.length).entries()) {
    const [category, description, countermeasure] = DEFECT_TEMPLATES[i];
    const id = `D-${String(defects.length + 1).padStart(3, "0")}`;
    defects.push({ id, caseId: c.id, drawingNumber: c.drawingNumber, date: addDays(c.quotedAt, 30), category, description, countermeasure });
    c.defectIds.push(id);
  }
  defects.sort((a, b) => a.id.localeCompare(b.id));
  return { cases, defects };
}
