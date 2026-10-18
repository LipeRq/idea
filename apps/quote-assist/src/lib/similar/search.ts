import {
  MATERIAL_GROUP_LABEL,
  NO_TREATMENT,
  PROCESS_TYPE_LABEL,
  type Defect,
  type Dimensions,
  type MaterialGroup,
  type PastCase,
  type ProcessType,
  type RateTable,
} from "../domain/reference";
import type { SimilarCase, Spec } from "../domain/inquiry";
import { formatDimensions, normalizeText } from "../extraction/normalize";

// 類似案件の検索。外部のベクトルDBは使わず、過去案件を全件採点する(数千件までは十分速い)。
// 配点は docs/manufacturing/quote-assist-design.md の「5. 類似案件検索」を参照。

export type CaseQuery = {
  drawingNumber: string | null;
  revision: string | null;
  materialId: string | null;
  materialGroup: MaterialGroup | null;
  processType: ProcessType | null;
  dimensions: Dimensions | null;
  toleranceMm: number | null;
  surfaceTreatmentId: string | null;
  heatTreatmentId: string | null;
  customerId: string | null;
  text: string;
};

export const WEIGHTS = {
  drawing: 25,
  material: 20,
  processType: 15,
  size: 15,
  text: 10,
  tolerance: 5,
  surface: 5,
  heat: 3,
  customer: 2,
} as const;

const FACTOR_LABEL: Record<keyof typeof WEIGHTS, string> = {
  drawing: "図番",
  material: "材質",
  processType: "加工種別",
  size: "サイズ",
  text: "品名・形状特徴",
  tolerance: "公差",
  surface: "表面処理",
  heat: "熱処理",
  customer: "顧客",
};

/** 実績工数が見積工数をこの割合以上上回ったら赤字の可能性として警告する */
export const OVERRUN_RATE = 0.15;

export function buildCaseQuery(spec: Spec, rates: RateTable): CaseQuery {
  const materialId = spec.materialId ?? spec.materialCandidates[0] ?? null;
  const material = rates.materials.find((m) => m.id === materialId);
  const treatment = (id: string | null, candidates: string[]) =>
    id === NO_TREATMENT ? null : (id ?? candidates[0] ?? null);
  return {
    drawingNumber: spec.drawingNumber,
    revision: spec.revision,
    materialId: spec.materialId,
    materialGroup: material?.group ?? null,
    processType: spec.processType,
    dimensions: spec.dimensions,
    toleranceMm: spec.toleranceMm,
    surfaceTreatmentId: treatment(spec.surfaceTreatmentId, spec.surfaceTreatmentCandidates),
    heatTreatmentId: treatment(spec.heatTreatmentId, spec.heatTreatmentCandidates),
    customerId: spec.customerId,
    text: [spec.partName, ...spec.features].filter(Boolean).join(" "),
  };
}

/** 外形寸法を大きい順に並べ、各軸の 小÷大 の平均(0〜1) */
export function sizeSimilarity(a: Dimensions, b: Dimensions): number {
  const axes = (d: Dimensions) =>
    (d.shape === "round"
      ? [d.lengthMm, d.diameterMm ?? 0, d.diameterMm ?? 0]
      : [d.lengthMm, d.widthMm ?? 0, d.heightMm ?? 0]
    ).sort((x, y) => y - x);
  const xa = axes(a);
  const xb = axes(b);
  const ratios = xa.map((v, i) => {
    const hi = Math.max(v, xb[i]);
    return hi > 0 ? Math.min(v, xb[i]) / hi : 1;
  });
  return ratios.reduce((s, r) => s + r, 0) / ratios.length;
}

function bigrams(text: string): Map<string, number> {
  const chars = [...normalizeText(text).toUpperCase().replace(/\s+/g, "")];
  const grams = new Map<string, number>();
  for (let i = 0; i < chars.length - 1; i++) {
    const g = chars[i] + chars[i + 1];
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  return grams;
}

/** 文字2-gramのコサイン類似度(0〜1)。日本語の品名でも分かち書きなしで比べられる */
export function textSimilarity(a: string, b: string): number {
  const ga = bigrams(a);
  const gb = bigrams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let dot = 0;
  for (const [g, n] of ga) dot += n * (gb.get(g) ?? 0);
  const norm = (m: Map<string, number>) => Math.sqrt([...m.values()].reduce((s, n) => s + n * n, 0));
  return dot / (norm(ga) * norm(gb));
}

function toleranceClass(t: number | null): number {
  if (t === null) return 2;
  return t <= 0.01 ? 0 : t <= 0.05 ? 1 : 2;
}
const TOLERANCE_CLASS_LABEL = ["±0.01以下", "±0.05以下", "それ以外(普通公差を含む)"];

export function cycleHours(processes: { cycleHoursPerPiece: number }[]): number {
  return Math.round(processes.reduce((s, p) => s + p.cycleHoursPerPiece, 0) * 100) / 100;
}

export function caseWarnings(c: PastCase, defects: Defect[]): string[] {
  const warnings: string[] = [];
  if (c.actualProcesses) {
    const est = cycleHours(c.estimatedProcesses);
    const act = cycleHours(c.actualProcesses);
    if (act > est * (1 + OVERRUN_RATE)) {
      warnings.push(
        `見積工数${est}時間に対し実績${act}時間(1個あたり、+${Math.round((act / est - 1) * 100)}%)。赤字の可能性`,
      );
    }
  }
  if (c.result === "lost" && c.lostReason) warnings.push(`失注:${c.lostReason}`);
  for (const id of c.defectIds) {
    const d = defects.find((x) => x.id === id);
    if (d) warnings.push(`不具合:${d.category}(${d.description})`);
  }
  return warnings;
}

export function scoreCase(
  query: CaseQuery,
  c: PastCase,
  rates: RateTable,
): { score: number; breakdown: SimilarCase["breakdown"]; reasons: string[] } {
  const points: Record<keyof typeof WEIGHTS, number> = {
    drawing: 0,
    material: 0,
    processType: 0,
    size: 0,
    text: 0,
    tolerance: 0,
    surface: 0,
    heat: 0,
    customer: 0,
  };
  const reasons: [number, string][] = [];
  const material = rates.materials.find((m) => m.id === c.materialId);

  if (query.drawingNumber && normalizeText(query.drawingNumber).toUpperCase() === c.drawingNumber.toUpperCase()) {
    points.drawing = WEIGHTS.drawing;
    reasons.push([
      points.drawing,
      query.revision && query.revision !== c.revision ? `同じ図番の旧版(Rev.${c.revision})` : `同じ図番(Rev.${c.revision})`,
    ]);
  }
  if (query.materialId && query.materialId === c.materialId) {
    points.material = WEIGHTS.material;
    reasons.push([points.material, `材質が同じ(${c.materialId})`]);
  } else if (query.materialGroup && material?.group === query.materialGroup) {
    points.material = WEIGHTS.material / 2;
    reasons.push([points.material, `材質が同じ系統(${MATERIAL_GROUP_LABEL[query.materialGroup]}・${c.materialId})`]);
  }
  if (query.processType && query.processType === c.processType) {
    points.processType = WEIGHTS.processType;
    reasons.push([points.processType, `加工種別が同じ(${PROCESS_TYPE_LABEL[c.processType]})`]);
  }
  if (query.dimensions) {
    const sim = sizeSimilarity(query.dimensions, c.dimensions);
    points.size = WEIGHTS.size * sim;
    if (sim >= 0.75) reasons.push([points.size, `外形寸法が近い(${formatDimensions(c.dimensions)})`]);
  }
  const text = textSimilarity(query.text, [c.partName, ...c.features].join(" "));
  points.text = WEIGHTS.text * text;
  if (text >= 0.3) reasons.push([points.text, `品名・形状特徴が似ている(${c.partName})`]);
  if (toleranceClass(query.toleranceMm) === toleranceClass(c.toleranceMm)) {
    points.tolerance = WEIGHTS.tolerance;
    if (toleranceClass(c.toleranceMm) === 0) {
      reasons.push([points.tolerance, `公差が同じ等級(${TOLERANCE_CLASS_LABEL[0]})`]);
    }
  }
  if (query.surfaceTreatmentId === c.surfaceTreatmentId) {
    points.surface = WEIGHTS.surface;
    if (c.surfaceTreatmentId) {
      const name = rates.treatments.find((t) => t.id === c.surfaceTreatmentId)?.name;
      reasons.push([points.surface, `表面処理が同じ(${name})`]);
    }
  }
  if (query.heatTreatmentId === c.heatTreatmentId) points.heat = WEIGHTS.heat;
  if (query.customerId && query.customerId === c.customerId) {
    points.customer = WEIGHTS.customer;
    reasons.push([points.customer, "同じ顧客"]);
  }

  const breakdown = (Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).map((k) => ({
    factor: k,
    label: FACTOR_LABEL[k],
    points: Math.round(points[k] * 10) / 10,
    max: WEIGHTS[k],
  }));
  const score = Math.round(breakdown.reduce((s, b) => s + b.points, 0) * 10) / 10;
  return {
    score,
    breakdown,
    reasons: reasons.sort((a, b) => b[0] - a[0]).slice(0, 4).map(([, r]) => r),
  };
}

export function searchSimilarCases(
  query: CaseQuery,
  cases: PastCase[],
  rates: RateTable,
  defects: Defect[],
  options: { limit?: number; minScore?: number } = {},
): SimilarCase[] {
  const { limit = 8, minScore = 30 } = options;
  return cases
    .map((c) => ({ c, ...scoreCase(query, c, rates) }))
    .filter((x) => x.score >= minScore)
    // 同点なら新しい案件を先にする
    .sort((a, b) => b.score - a.score || b.c.quotedAt.localeCompare(a.c.quotedAt))
    .slice(0, limit)
    .map(({ c, score, breakdown, reasons }) => ({
      caseId: c.id,
      score,
      breakdown,
      reasons,
      aiReason: null,
      warnings: caseWarnings(c, defects),
    }));
}
