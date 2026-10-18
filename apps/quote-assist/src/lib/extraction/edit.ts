import { z } from "zod";
import {
  DimensionsSchema,
  NO_TREATMENT,
  PROCESS_TYPE_LABEL,
  PROCESS_TYPES,
  type Customer,
  type RateTable,
} from "../domain/reference";
import {
  FIELD_LABEL,
  type ExtractedField,
  type FieldKey,
  type Inquiry,
  type ReviewLogEntry,
  type Spec,
} from "../domain/inquiry";
import { formatJpDate } from "../dates";
import { formatDimensions, matchCustomer, treatmentLabel } from "./normalize";
import { applyRules } from "./rules";

// 人による抽出結果の修正。修正した項目は確信度「高」・人が修正、として扱い、修正前後を記録する。

const text = z.string().trim().max(100).nullable();

export const ExtractionEditsSchema = z
  .object({
    customerName: text,
    partName: text,
    drawingNumber: text,
    revision: z.string().trim().max(10).nullable(),
    material: z.string().nullable(),
    quantity: z.number().int().min(1).max(100_000).nullable(),
    dimensions: DimensionsSchema.nullable(),
    tolerance: z.number().positive().max(10).nullable(),
    surfaceTreatment: z.string().nullable(),
    heatTreatment: z.string().nullable(),
    dueDate: z.iso.date().nullable(),
    inspection: z.string().trim().max(200).nullable(),
    processType: z.enum(PROCESS_TYPES).nullable(),
  })
  .partial()
  .strict();
export type ExtractionEdits = z.infer<typeof ExtractionEditsSchema>;

export class EditError extends Error {}

/** 画面に出す値 */
export function displayOf(key: FieldKey, spec: Spec, rates: RateTable): string {
  switch (key) {
    case "customerName":
      return spec.customerName ?? "";
    case "material":
      return spec.materialId ?? "";
    case "quantity":
      return spec.quantity ? `${spec.quantity.toLocaleString("ja-JP")}個` : "";
    case "dimensions":
      return spec.dimensions ? formatDimensions(spec.dimensions) : "";
    case "tolerance":
      return spec.toleranceMm ? `±${spec.toleranceMm} mm` : "普通公差のみ";
    case "surfaceTreatment":
      return spec.surfaceTreatmentId ? treatmentLabel(spec.surfaceTreatmentId, rates) : "";
    case "heatTreatment":
      return spec.heatTreatmentId ? treatmentLabel(spec.heatTreatmentId, rates) : "";
    case "dueDate":
      return spec.dueDate ? formatJpDate(spec.dueDate, true) : "";
    case "processType":
      return spec.processType ? PROCESS_TYPE_LABEL[spec.processType] : "";
    default:
      return spec[key] ?? "";
  }
}

function checkTreatment(id: string | null, rates: RateTable, kind: "surface" | "heat") {
  if (id === null || id === NO_TREATMENT) return;
  if (!rates.treatments.some((t) => t.id === id && t.kind === kind)) {
    throw new EditError("単価表にない表面処理・熱処理です");
  }
}

export function applyExtractionEdits(
  inquiry: Inquiry,
  edits: ExtractionEdits,
  ctx: { rates: RateTable; customers: Customer[]; today: string; now: string },
): { extraction: Inquiry["extraction"]; log: ReviewLogEntry[] } {
  const { rates } = ctx;
  const spec: Spec = structuredClone(inquiry.extraction.spec);
  const changed = new Set<FieldKey>();
  const set = <K extends keyof Spec>(field: FieldKey, k: K, value: Spec[K]) => {
    if (JSON.stringify(spec[k]) === JSON.stringify(value)) return;
    spec[k] = value;
    changed.add(field);
  };

  if (edits.customerName !== undefined) {
    const customer = matchCustomer(edits.customerName, "", ctx.customers);
    set("customerName", "customerName", customer?.name ?? edits.customerName);
    spec.customerId = customer?.id ?? null;
  }
  if (edits.partName !== undefined) set("partName", "partName", edits.partName || null);
  if (edits.drawingNumber !== undefined) set("drawingNumber", "drawingNumber", edits.drawingNumber?.toUpperCase() || null);
  if (edits.revision !== undefined) set("revision", "revision", edits.revision || null);
  if (edits.material !== undefined) {
    if (edits.material !== null && !rates.materials.some((m) => m.id === edits.material)) {
      throw new EditError("単価表にない材質です");
    }
    set("material", "materialId", edits.material);
    spec.materialCandidates = [];
  }
  if (edits.quantity !== undefined) set("quantity", "quantity", edits.quantity);
  if (edits.dimensions !== undefined) set("dimensions", "dimensions", edits.dimensions);
  if (edits.tolerance !== undefined) set("tolerance", "toleranceMm", edits.tolerance);
  if (edits.surfaceTreatment !== undefined) {
    checkTreatment(edits.surfaceTreatment, rates, "surface");
    set("surfaceTreatment", "surfaceTreatmentId", edits.surfaceTreatment);
    spec.surfaceTreatmentCandidates = [];
  }
  if (edits.heatTreatment !== undefined) {
    checkTreatment(edits.heatTreatment, rates, "heat");
    set("heatTreatment", "heatTreatmentId", edits.heatTreatment);
    spec.heatTreatmentCandidates = [];
  }
  if (edits.dueDate !== undefined) set("dueDate", "dueDate", edits.dueDate);
  if (edits.inspection !== undefined) set("inspection", "inspection", edits.inspection || null);
  if (edits.processType !== undefined) set("processType", "processType", edits.processType);

  const log: ReviewLogEntry[] = [];
  const drafts = inquiry.extraction.fields.map((f): ExtractedField => {
    if (!changed.has(f.key)) return f;
    const after = displayOf(f.key, spec, rates);
    log.push({
      at: ctx.now,
      kind: "field",
      key: f.key,
      label: FIELD_LABEL[f.key],
      before: f.display || "(空欄)",
      after: after || "(空欄)",
    });
    return { ...f, display: after, confidence: "high", editedByHuman: true, issue: null };
  });
  const { fields, questions } = applyRules(spec, drafts, inquiry.extraction.aiQuestions, {
    rates,
    today: ctx.today,
  });
  return { extraction: { ...inquiry.extraction, spec, fields, questions }, log };
}
