import { NO_TREATMENT, type PastCase, type RateTable } from "../domain/reference";
import type { SimilarCase, Spec } from "../domain/inquiry";
import { businessDaysBetween } from "../dates";
import { standardLeadDays } from "./calculate";
import type { QuoteInput, QuoteProcessInput } from "./types";

// 抽出した仕様と工数案から、見積計算の入力を組み立てる。
// 材質・数量・寸法が未確定のときは仮の値を置き、その旨を assumptions に残す(画面で警告する)。

export function buildQuoteInput(
  spec: Spec,
  processes: QuoteProcessInput[],
  ctx: { rates: RateTable; similar: SimilarCase[]; cases: PastCase[]; today: string },
): { input: QuoteInput; assumptions: string[] } {
  const { rates } = ctx;
  const assumptions: string[] = [];
  const top = ctx.similar
    .map((s) => ctx.cases.find((c) => c.id === s.caseId))
    .find((c): c is PastCase => c !== undefined);

  let materialId = spec.materialId;
  if (!materialId && spec.materialCandidates[0]) {
    materialId = spec.materialCandidates[0];
    assumptions.push(`材質が未確定のため ${materialId} で仮計算しています`);
  }
  if (!materialId) {
    materialId = top?.materialId ?? rates.materials[0].id;
    assumptions.push(`材質が分からないため ${materialId}(${top ? "最も似た過去案件の材質" : "単価表の先頭"})で仮計算しています`);
  }

  let dimensions = spec.dimensions;
  if (!dimensions) {
    dimensions = top?.dimensions ?? { shape: "block", lengthMm: 100, widthMm: 50, heightMm: 20, diameterMm: null };
    assumptions.push("外形寸法が分からないため、最も似た過去案件の寸法で仮計算しています");
  }

  let quantity = spec.quantity;
  if (!quantity) {
    quantity = 1;
    assumptions.push("数量が未確定のため1個で計算しています(数量段階別の単価も参照してください)");
  }

  const treatments: QuoteInput["treatments"] = [];
  for (const [id, candidates, label] of [
    [spec.surfaceTreatmentId, spec.surfaceTreatmentCandidates, "表面処理"],
    [spec.heatTreatmentId, spec.heatTreatmentCandidates, "熱処理"],
  ] as const) {
    if (id && id !== NO_TREATMENT) {
      treatments.push({ treatmentId: id, unitPriceOverride: null });
    } else if (!id && candidates[0]) {
      treatments.push({ treatmentId: candidates[0], unitPriceOverride: null });
      const name = rates.treatments.find((t) => t.id === candidates[0])?.name;
      assumptions.push(`${label}の種類が未確定のため ${name} で仮計算しています`);
    } else if (!id) {
      assumptions.push(`${label}の要否が未確定のため、${label}なしで計算しています`);
    }
  }

  const input: QuoteInput = {
    quantity,
    material: { materialId, dimensions, pricePerKgOverride: null },
    processes,
    treatments,
    profitRate: rates.rules.defaultProfitRate,
    expedite: false,
  };
  input.expedite = needsExpedite(input, spec.dueDate, ctx.today, rates);
  return { input, assumptions };
}

/** 希望納期までの営業日数が標準リードタイムより短ければ特急 */
export function needsExpedite(input: QuoteInput, dueDate: string | null, today: string, rates: RateTable): boolean {
  if (!dueDate) return false;
  return businessDaysBetween(today, dueDate) < standardLeadDays(input, rates);
}
