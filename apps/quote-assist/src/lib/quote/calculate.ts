import type { Dimensions, RateTable } from "../domain/reference";
import { formatNumber, formatYen } from "../format";
import type { QuoteInput, QuoteLine, QuoteResult, QuoteTier } from "./types";

// 見積金額の計算。AIは使わない。同じ入力と単価表なら必ず同じ結果になる。
// 計算式は docs/manufacturing/quote-assist-design.md の「4. 見積計算式」を参照。

export class QuoteInputError extends Error {}

/** 仕上がり形状の体積[cm³] */
export function volumeCm3(d: Dimensions): number {
  if (d.shape === "round") return (Math.PI * ((d.diameterMm ?? 0) / 2) ** 2 * d.lengthMm) / 1000;
  return (d.lengthMm * (d.widthMm ?? 0) * (d.heightMm ?? 0)) / 1000;
}

/** 仕上がり重量[kg](外形の体積から。穴・ポケットは差し引かない)。重量単価の外注費に使う */
export function partWeightKg(dimensions: Dimensions, densityGPerCm3: number): number {
  return Math.max(0.001, round((volumeCm3(dimensions) * densityGPerCm3) / 1000, 3));
}

/** 素材(取り代を含む)の重量[kg]。小数3桁に丸める */
export function blankWeightKg(
  dimensions: Dimensions,
  densityGPerCm3: number,
  rates: RateTable,
): number {
  const a = rates.rules.blankAllowanceMm[dimensions.shape];
  const length = dimensions.lengthMm + a.lengthMm;
  let volumeMm3: number;
  if (dimensions.shape === "round") {
    const d = (dimensions.diameterMm ?? 0) + a.diameterMm;
    volumeMm3 = Math.PI * (d / 2) ** 2 * length;
  } else {
    const width = (dimensions.widthMm ?? 0) + a.widthMm;
    const height = (dimensions.heightMm ?? 0) + a.heightMm;
    volumeMm3 = length * width * height;
  }
  return round((volumeMm3 / 1000) * densityGPerCm3 / 1000, 3);
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
  const weightKg = blankWeightKg(input.material.dimensions, material.densityGPerCm3, rates);
  const partKg = partWeightKg(input.material.dimensions, material.densityGPerCm3);
  const pricePerKg = input.material.pricePerKgOverride ?? material.pricePerKg;
  const materialByWeight = Math.round(weightKg * quantity * pricePerKg);
  const materialAmount = Math.max(materialByWeight, material.minChargePerLot);
  lines.push({
    kind: "material",
    label: `材料費(${material.name})`,
    basis:
      materialByWeight >= material.minChargePerLot
        ? `${formatNumber(weightKg, 3)}kg × ${quantity}個 × ${formatYen(pricePerKg)}/kg`
        : `最低材料費 ${formatYen(material.minChargePerLot)}(重量計算 ${formatYen(materialByWeight)})`,
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
      const amount = Math.round(p.cycleHoursPerPiece * factor * quantity * charge);
      processingTotal += amount;
      hoursPerPiece += p.cycleHoursPerPiece * factor;
      lines.push({
        kind: "process",
        label: `加工費(${rate.name})`,
        basis:
          `${formatNumber(p.cycleHoursPerPiece, 2)}h` +
          (factor !== 1 ? ` × 数量係数${factor}` : "") +
          ` × ${quantity}個 × ${formatYen(charge)}/h`,
        amount,
        ref,
        overridden,
      });
    }
    if (p.setupHours > 0) {
      const amount = Math.round(p.setupHours * rate.setupChargePerHour);
      processingTotal += amount;
      setupHours += p.setupHours;
      lines.push({
        kind: "setup",
        label: `段取り費(${rate.name})`,
        basis: `${formatNumber(p.setupHours, 2)}h × ${formatYen(rate.setupChargePerHour)}/h(ロットに1回)`,
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
        ? Math.round(unitPrice * partKg * quantity)
        : Math.round(unitPrice * quantity);
    const amount = Math.max(byUnit, rate.minLotCharge);
    outsourcingTotal += amount;
    const unitBasis =
      rate.pricing === "per_kg"
        ? `${formatYen(unitPrice)}/kg × 仕上がり${formatNumber(partKg, 3)}kg × ${quantity}個`
        : `${formatYen(unitPrice)}/個 × ${quantity}個`;
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
    expediteAmount = Math.round(processingTotal * rules.expedite.surchargeRate);
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
  const overhead = Math.round(directCost * rules.overheadRate);
  lines.push({
    kind: "overhead",
    label: "管理費",
    basis: `直接原価 ${formatYen(directCost)} × ${percent(rules.overheadRate)}`,
    amount: overhead,
    ref: { type: "rule", key: "overheadRate" },
    overridden: false,
  });
  const profit = Math.round((directCost + overhead) * input.profitRate);
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
  const unitPrice = Math.ceil(rawTotal / quantity / step) * step;
  const total = unitPrice * quantity;
  if (total !== rawTotal) {
    lines.push({
      kind: "rounding",
      label: "端数調整",
      basis: `単価を${step}円単位に切り上げ(${formatYen(unitPrice)} × ${quantity}個)`,
      amount: total - rawTotal,
      ref: { type: "rule", key: "rounding" },
      overridden: false,
    });
  }

  return {
    quantity,
    weightKgPerPiece: weightKg,
    partWeightKgPerPiece: partKg,
    lines,
    directCost,
    overhead,
    profit,
    rawTotal,
    unitPrice,
    total,
    hoursPerPiece: round(hoursPerPiece, 3),
    setupHours: round(setupHours, 3),
    quantityFactor: factor,
    standardLeadDays: standardLeadDays(input, rates),
  };
}

function findTreatment(rates: RateTable, id: string) {
  const t = rates.treatments.find((r) => r.id === id);
  if (!t) throw new QuoteInputError(`単価表にない表面処理・熱処理です: ${id}`);
  return t;
}

function percent(rate: number): string {
  return `${formatNumber(rate * 100, 1)}%`;
}

function round(value: number, digits: number): number {
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}
