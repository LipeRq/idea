import type { Dimensions, RateTable } from "../domain/reference";
import { formatNumber, formatRate as percent, formatYen } from "../format";
import { addDecimal, roundProduct } from "./decimal";
import { QuoteInputSchema, type QuoteInput, type QuoteLine, type QuoteResult, type QuoteTier } from "./types";

// 見積金額の計算。AIは使わない。同じ入力と単価表なら必ず同じ結果になる。
// 計算式は docs/manufacturing/quote-assist-design.md の「4. 見積計算式」を参照。
// 掛け算は10進で正確に行い、円未満は明細ごとに1回だけ四捨五入する(decimal.ts)。
// 明細の計算式(basis)には計算に使った値をそのまま出し、手計算で同じ金額になるようにする。

export class QuoteInputError extends Error {}

/** 仕上がり形状の体積[cm³] */
export function volumeCm3(d: Dimensions): number {
  if (d.shape === "round") return (Math.PI * ((d.diameterMm ?? 0) / 2) ** 2 * d.lengthMm) / 1000;
  return (d.lengthMm * (d.widthMm ?? 0) * (d.heightMm ?? 0)) / 1000;
}

/**
 * 重量[kg] = 体積[mm³] × 比重[g/cm³] ÷ 1,000,000 を小数3桁に四捨五入する。
 * 角物・板物は10進で正確に計算し、丸物は π を含むので浮動小数点の体積から計算する。
 */
function weightKg(
  shape: Dimensions["shape"],
  mm: { length: number; width: number; height: number; diameter: number },
  densityGPerCm3: number,
): number {
  if (shape === "round") {
    const volumeMm3 = Math.PI * (mm.diameter / 2) ** 2 * mm.length;
    return roundProduct([volumeMm3, densityGPerCm3, 1e-6], 3);
  }
  return roundProduct([mm.length, mm.width, mm.height, densityGPerCm3, 1e-6], 3);
}

/** 仕上がり重量[kg](外形の体積から。穴・ポケットは差し引かない)。重量単価の外注費に使う。最小1g */
export function partWeightKg(dimensions: Dimensions, densityGPerCm3: number): number {
  const mm = {
    length: dimensions.lengthMm,
    width: dimensions.widthMm ?? 0,
    height: dimensions.heightMm ?? 0,
    diameter: dimensions.diameterMm ?? 0,
  };
  return Math.max(0.001, weightKg(dimensions.shape, mm, densityGPerCm3));
}

/** 素材(取り代を含む)の重量[kg]。小数3桁に四捨五入する */
export function blankWeightKg(
  dimensions: Dimensions,
  densityGPerCm3: number,
  rates: RateTable,
): number {
  const a = rates.rules.blankAllowanceMm[dimensions.shape];
  const mm = {
    length: addDecimal(dimensions.lengthMm, a.lengthMm),
    width: addDecimal(dimensions.widthMm ?? 0, a.widthMm),
    height: addDecimal(dimensions.heightMm ?? 0, a.heightMm),
    diameter: addDecimal(dimensions.diameterMm ?? 0, a.diameterMm),
  };
  return weightKg(dimensions.shape, mm, densityGPerCm3);
}

/** 数量に応じた加工時間の係数(量産効果) */
export function quantityFactor(quantity: number, rates: RateTable): number {
  let factor = 1;
  for (const b of [...rates.rules.quantityBreaks].sort((x, y) => x.minQty - y.minQty)) {
    if (quantity >= b.minQty) factor = b.factor;
  }
  return factor;
}

/** 標準リードタイム(営業日)= 基本日数 + 数量による加算 + 外注の標準日数 */
export function standardLeadDays(input: QuoteInput, rates: RateTable): number {
  const { baseDays, extraDaysPer50Pieces } = rates.rules.leadTime;
  const outsourcing = input.treatments.reduce(
    (sum, t) => sum + (findTreatment(rates, t.treatmentId).leadDays ?? 0),
    0,
  );
  return baseDays + Math.floor((input.quantity - 1) / 50) * extraDaysPer50Pieces + outsourcing;
}

export function calculateQuote(input: QuoteInput, rates: RateTable): QuoteResult {
  // 画面の途中の入力やAPIからの値でも、範囲外・重複があれば計算しない(負の数量や二重計上を防ぐ)
  const parsed = QuoteInputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new QuoteInputError(
      issue?.code === "custom" ? issue.message : `見積の入力に誤りがあります(${issue?.path.join(".") || "全体"})`,
    );
  }
  const main = calculateCore(input, rates);
  const quantities = [...new Set([...rates.rules.quantityTiers, input.quantity])].sort(
    (a, b) => a - b,
  );
  const tiers: QuoteTier[] = quantities.map((quantity) => {
    if (quantity === input.quantity) {
      return { quantity, unitPrice: main.unitPrice, total: main.total };
    }
    const r = calculateCore({ ...input, quantity }, rates);
    return { quantity, unitPrice: r.unitPrice, total: r.total };
  });
  return { ...main, tiers };
}

function calculateCore(input: QuoteInput, rates: RateTable): Omit<QuoteResult, "tiers"> {
  const { quantity } = input;
  const { rules } = rates;
  const lines: QuoteLine[] = [];

  // 材料費
  const material = rates.materials.find((m) => m.id === input.material.materialId);
  if (!material) throw new QuoteInputError(`単価表にない材質です: ${input.material.materialId}`);
  const weightKgPerPiece = blankWeightKg(input.material.dimensions, material.densityGPerCm3, rates);
  const partKg = partWeightKg(input.material.dimensions, material.densityGPerCm3);
  const pricePerKg = input.material.pricePerKgOverride ?? material.pricePerKg;
  const materialByWeight = roundProduct([weightKgPerPiece, quantity, pricePerKg]);
  const materialAmount = Math.max(materialByWeight, material.minChargePerLot);
  const weightBasis = `${formatNumber(weightKgPerPiece, 3)}kg × ${pieces(quantity)} × ${unitYen(pricePerKg)}/kg`;
  lines.push({
    kind: "material",
    label: `材料費(${material.name})`,
    basis:
      materialByWeight >= material.minChargePerLot
        ? weightBasis
        : `最低材料費 ${formatYen(material.minChargePerLot)}(${weightBasis} = ${formatYen(materialByWeight)})`,
    amount: materialAmount,
    ref: { type: "material", id: material.id },
    overridden: input.material.pricePerKgOverride !== null,
  });

  // 加工費と段取り費(工程ごと)
  const factor = quantityFactor(quantity, rates);
  let processingTotal = 0;
  let hoursPerPiece = 0;
  let setupHours = 0;
  for (const p of input.processes) {
    const rate = rates.processes.find((r) => r.id === p.processId);
    if (!rate) throw new QuoteInputError(`単価表にない工程です: ${p.processId}`);
    const charge = p.chargeOverride ?? rate.chargePerHour;
    const ref = {
      type: "process" as const,
      id: rate.id,
      caseIds: p.source.caseIds,
      sourceKind: p.source.kind,
    };
    const overridden = p.chargeOverride !== null || p.source.kind === "human";

    if (p.cycleHoursPerPiece > 0) {
      const amount = roundProduct([p.cycleHoursPerPiece, factor, quantity, charge]);
      processingTotal += amount;
      hoursPerPiece += roundProduct([p.cycleHoursPerPiece, factor], 6);
      lines.push({
        kind: "process",
        label: `加工費(${rate.name})`,
        basis:
          `${hours(p.cycleHoursPerPiece)}h` +
          (factor !== 1 ? ` × 数量係数${factor}` : "") +
          ` × ${pieces(quantity)} × ${unitYen(charge)}/h`,
        amount,
        ref,
        overridden,
      });
    }
    if (p.setupHours > 0) {
      const amount = roundProduct([p.setupHours, rate.setupChargePerHour]);
      processingTotal += amount;
      setupHours += p.setupHours;
      lines.push({
        kind: "setup",
        label: `段取り費(${rate.name})`,
        basis: `${hours(p.setupHours)}h × ${unitYen(rate.setupChargePerHour)}/h(ロットに1回)`,
        amount,
        ref,
        overridden,
      });
    }
  }

  // 外注費(表面処理・熱処理)
  let outsourcingTotal = 0;
  for (const t of input.treatments) {
    const rate = findTreatment(rates, t.treatmentId);
    const unitPrice = t.unitPriceOverride ?? rate.unitPrice;
    const byUnit =
      rate.pricing === "per_kg"
        ? roundProduct([unitPrice, partKg, quantity])
        : roundProduct([unitPrice, quantity]);
    const amount = Math.max(byUnit, rate.minLotCharge);
    outsourcingTotal += amount;
    const unitBasis =
      rate.pricing === "per_kg"
        ? `${unitYen(unitPrice)}/kg × 仕上がり${formatNumber(partKg, 3)}kg × ${pieces(quantity)}`
        : `${unitYen(unitPrice)}/個 × ${pieces(quantity)}`;
    lines.push({
      kind: "treatment",
      label: `${rate.kind === "heat" ? "熱処理" : "表面処理"}(${rate.name}・外注)`,
      basis:
        byUnit >= rate.minLotCharge
          ? unitBasis
          : `最低ロット料金 ${formatYen(rate.minLotCharge)}(${unitBasis} = ${formatYen(byUnit)})`,
      amount,
      ref: { type: "treatment", id: rate.id },
      overridden: t.unitPriceOverride !== null,
    });
  }

  // 特急料金
  let expediteAmount = 0;
  if (input.expedite) {
    expediteAmount = roundProduct([processingTotal, rules.expedite.surchargeRate]);
    lines.push({
      kind: "expedite",
      label: "特急料金",
      basis: `(加工費+段取り費)${formatYen(processingTotal)} × ${percent(rules.expedite.surchargeRate)}`,
      amount: expediteAmount,
      ref: { type: "rule", key: "expedite" },
      overridden: false,
    });
  }

  const directCost = materialAmount + processingTotal + outsourcingTotal + expediteAmount;
  const overhead = roundProduct([directCost, rules.overheadRate]);
  lines.push({
    kind: "overhead",
    label: "管理費",
    basis: `直接原価 ${formatYen(directCost)} × ${percent(rules.overheadRate)}`,
    amount: overhead,
    ref: { type: "rule", key: "overheadRate" },
    overridden: false,
  });
  const profit = roundProduct([directCost + overhead, input.profitRate]);
  lines.push({
    kind: "profit",
    label: "利益",
    basis: `(直接原価+管理費)${formatYen(directCost + overhead)} × ${percent(input.profitRate)}`,
    amount: profit,
    ref: { type: "rule", key: "defaultProfitRate" },
    overridden: input.profitRate !== rules.defaultProfitRate,
  });

  const rawTotal = directCost + overhead + profit;
  const step = rules.rounding.unitStepYen;
  // 単価 = 切り上げ(合計 ÷ 数量, step円単位)。整数のまま割り算する
  const lot = BigInt(quantity) * BigInt(step);
  const unitPrice = Number(((BigInt(rawTotal) + lot - BigInt(1)) / lot) * BigInt(step));
  const total = unitPrice * quantity;
  if (total !== rawTotal) {
    lines.push({
      kind: "rounding",
      label: "端数調整",
      basis: `単価を${step}円単位に切り上げ(${formatYen(unitPrice)} × ${pieces(quantity)})`,
      amount: total - rawTotal,
      ref: { type: "rule", key: "rounding" },
      overridden: false,
    });
  }

  return {
    quantity,
    weightKgPerPiece,
    partWeightKgPerPiece: partKg,
    lines,
    directCost,
    overhead,
    profit,
    rawTotal,
    unitPrice,
    total,
    hoursPerPiece: roundProduct([hoursPerPiece], 3),
    setupHours: roundProduct([setupHours], 3),
    quantityFactor: factor,
    standardLeadDays: standardLeadDays(input, rates),
  };
}

function findTreatment(rates: RateTable, id: string) {
  const t = rates.treatments.find((r) => r.id === id);
  if (!t) throw new QuoteInputError(`単価表にない表面処理・熱処理です: ${id}`);
  return t;
}

// 計算式の表示。計算に使った値を丸めずに出す(小数4桁まで)

function hours(value: number): string {
  return formatNumber(value, 4);
}

function unitYen(value: number): string {
  return `${formatNumber(value, 4)}円`;
}

function pieces(quantity: number): string {
  return `${formatNumber(quantity, 0)}個`;
}
