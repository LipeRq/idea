import {
  MATERIAL_GROUP_LABEL,
  NO_TREATMENT,
  PROCESS_TYPE_LABEL,
  PROCESS_TYPES,
  SHAPES,
  type Customer,
  type Dimensions,
  type MaterialGroup,
  type RateTable,
  type TreatmentRate,
} from "../domain/reference";
import {
  CONFIDENCES,
  FIELD_KEYS,
  type Confidence,
  type ExtractedField,
  type FieldKey,
  type Question,
  type Source,
  type Spec,
} from "../domain/inquiry";
import { formatJpDate } from "../dates";
import type { ExtractionOutput } from "./schema";

// AIの抽出結果(図面の表記のまま)を、単価表のidや数値に対応づける。ここはすべて決定的な処理。

/** 全角・半角、大文字・小文字、空白の違いをそろえる */
export function normalizeText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function key(value: string): string {
  return normalizeText(value).toUpperCase().replace(/[\s\-_・]/g, "");
}

const GROUP_WORDS: [MaterialGroup, RegExp][] = [
  ["stainless", /SUS|ステンレス/],
  ["aluminum", /アルミ|ジュラルミン|^AL|^A[1-7]\d/],
  ["copper", /真鍮|黄銅|銅|^C[1-6]\d/],
  ["steel", /^SS|^S\d|^SC|^SP|鉄|鋼|スチール/],
];

export type MaterialMatch = { id: string | null; candidates: string[]; issue: string | null };

export function matchMaterial(raw: string | null, rates: RateTable): MaterialMatch {
  if (!raw) return { id: null, candidates: [], issue: null };
  const k = key(raw);
  for (const m of rates.materials) {
    if ([m.id, m.name, ...m.aliases].some((a) => key(a) === k)) {
      return { id: m.id, candidates: [], issue: null };
    }
  }
  // A5052P、S45C-D のような末尾の記号つき表記
  for (const m of rates.materials) {
    if (k.startsWith(key(m.id)) && key(m.id).length >= 4) return { id: m.id, candidates: [], issue: null };
  }
  const group = GROUP_WORDS.find(([, re]) => re.test(k))?.[0];
  if (group) {
    const candidates = rates.materials.filter((m) => m.group === group).map((m) => m.id);
    return {
      id: null,
      candidates,
      issue: `「${raw}」は${MATERIAL_GROUP_LABEL[group]}の材質名で、種類(${candidates.join("・")}など)が決まっていません`,
    };
  }
  return { id: null, candidates: [], issue: `「${raw}」は単価表にない材質です` };
}

export type TreatmentMatch = { id: string | null; candidates: string[]; issue: string | null };

const NONE_WORDS = /^(なし|無し|不要|無|—|-|ー|-|NONE)$/i;

/** 表面処理・熱処理の表記を単価表の処理に対応づける。いちばん長く一致した名前を採用する */
export function matchTreatment(
  raw: string | null,
  rates: RateTable,
  kind: TreatmentRate["kind"],
): TreatmentMatch {
  if (raw === null) return { id: null, candidates: [], issue: null };
  const k = key(raw);
  if (NONE_WORDS.test(k) || k === "") return { id: NO_TREATMENT, candidates: [], issue: null };
  const scored = rates.treatments
    .filter((t) => t.kind === kind)
    .map((t) => {
      const names = [t.name, ...t.aliases].map(key);
      // 表記が処理名を含む(「無電解ニッケルめっき 5μm」)か、処理名が表記を含む(「アルマイト」)
      const contains = Math.max(0, ...names.filter((n) => k.includes(n)).map((n) => n.length));
      const containedBy = names.some((n) => n.includes(k)) ? k.length : 0;
      return { t, score: Math.max(contains, containedBy), exact: contains > 0 };
    })
    .filter((s) => s.score > 0);
  if (scored.length === 0) {
    return { id: null, candidates: [], issue: `「${raw}」は単価表にない${kind === "heat" ? "熱処理" : "表面処理"}です` };
  }
  const best = Math.max(...scored.map((s) => s.score));
  const top = scored.filter((s) => s.score === best);
  if (top.length === 1 && top[0].exact) return { id: top[0].t.id, candidates: [], issue: null };
  const candidates = top.map((s) => s.t.id);
  if (candidates.length === 1) return { id: candidates[0], candidates: [], issue: null };
  return {
    id: null,
    candidates,
    issue: `「${raw}」は種類が決まっていません(${top.map((s) => s.t.name).join("・")})`,
  };
}

function companyKey(name: string): string {
  return key(name).replace(/株式会社|\(株\)|㈱|有限会社/g, "");
}

/** 差出人のメールのドメイン、次に社名で顧客マスタと照合する */
export function matchCustomer(
  name: string | null,
  fromAddress: string,
  customers: Customer[],
): Customer | null {
  const domain = fromAddress.split("@")[1]?.toLowerCase().trim();
  if (domain) {
    const byDomain = customers.find((c) => c.emailDomains.some((d) => d.toLowerCase() === domain));
    if (byDomain) return byDomain;
  }
  if (!name) return null;
  const k = companyKey(name);
  if (k.length < 2) return null;
  return customers.find((c) => companyKey(c.name) === k || companyKey(c.shortName) === k) ?? null;
}

export function formatDimensions(d: Dimensions): string {
  const n = (v: number | null) => (v ?? 0).toLocaleString("ja-JP", { maximumFractionDigits: 2 });
  if (d.shape === "round") return `φ${n(d.diameterMm)} × ${n(d.lengthMm)} mm`;
  if (d.shape === "sheet") return `${n(d.lengthMm)} × ${n(d.widthMm)} × t${n(d.heightMm)} mm`;
  return `${n(d.lengthMm)} × ${n(d.widthMm)} × ${n(d.heightMm)} mm`;
}

export function treatmentLabel(id: string | null, rates: RateTable): string {
  if (id === null) return "記載なし";
  if (id === NO_TREATMENT) return "なし";
  return rates.treatments.find((t) => t.id === id)?.name ?? id;
}

const asConfidence = (v: string): Confidence =>
  (CONFIDENCES as readonly string[]).includes(v) ? (v as Confidence) : "low";

function cleanDimensions(v: ExtractionOutput["dimensions"]["value"]): Dimensions | null {
  if (!v || !(SHAPES as readonly string[]).includes(v.shape)) return null;
  const pos = (x: number | null) => (x !== null && Number.isFinite(x) && x > 0 && x < 10_000 ? x : null);
  const d: Dimensions = {
    shape: v.shape as Dimensions["shape"],
    lengthMm: pos(v.lengthMm) ?? 0,
    widthMm: v.shape === "round" ? null : pos(v.widthMm),
    heightMm: v.shape === "round" ? null : pos(v.heightMm),
    diameterMm: v.shape === "round" ? pos(v.diameterMm) : null,
  };
  if (d.lengthMm <= 0) return null;
  if (d.shape === "round" ? d.diameterMm === null : d.widthMm === null || d.heightMm === null) return null;
  return d;
}

function cleanDate(value: string | null): string | null {
  if (!value) return null;
  const m = normalizeText(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  return new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso ? iso : null;
}

const clip = (s: string | null, max = 200) => (s === null ? null : normalizeText(s).slice(0, max) || null);

type FieldDraft = Omit<ExtractedField, "status" | "required" | "editedByHuman">;

export type NormalizedExtraction = {
  summary: string;
  spec: Spec;
  fields: FieldDraft[];
  aiQuestions: Question[];
};

export function normalizeExtraction(
  out: ExtractionOutput,
  ctx: { rates: RateTable; customers: Customer[]; from: string },
): NormalizedExtraction {
  const { rates } = ctx;
  const fields = new Map<FieldKey, FieldDraft>();
  const put = (
    k: FieldKey,
    f: { raw: string | null; confidence: string; sources: Source[]; note: string | null },
    display: string,
    issue: string | null = null,
  ) => {
    fields.set(k, {
      key: k,
      display,
      raw: clip(f.raw),
      confidence: asConfidence(f.confidence),
      sources: f.sources.slice(0, 5).map((s) => ({
        document: clip(s.document, 120) ?? "",
        page: s.page !== null && s.page > 0 ? s.page : null,
        location: clip(s.location, 120) ?? "",
        quote: clip(s.quote, 120) ?? "",
      })),
      note: clip(f.note),
      issue,
    });
  };
  const textOf = (v: string | null) => clip(v, 100);

  const customer = matchCustomer(textOf(out.customerName.value), ctx.from, ctx.customers);
  const customerName = customer?.name ?? textOf(out.customerName.value);
  put(
    "customerName",
    out.customerName,
    customerName ? `${customerName}${customer ? `(顧客マスタ ${customer.id})` : "(顧客マスタに該当なし・新規)"}` : "",
  );

  const partName = textOf(out.partName.value);
  put("partName", out.partName, partName ?? "");
  const drawingNumber = textOf(out.drawingNumber.value)?.toUpperCase() ?? null;
  put("drawingNumber", out.drawingNumber, drawingNumber ?? "");
  const revision = textOf(out.revision.value)?.replace(/^(REV\.?|版)\s*/i, "") ?? null;
  put("revision", out.revision, revision ?? "");

  const material = matchMaterial(textOf(out.material.value), rates);
  const materialName = material.id ?? textOf(out.material.value);
  put("material", out.material, materialName ?? "", material.issue);

  const qty = out.quantity.value;
  const quantity = qty !== null && Number.isInteger(qty) && qty > 0 && qty <= 100_000 ? qty : null;
  put("quantity", out.quantity, quantity ? `${quantity.toLocaleString("ja-JP")}個` : "");

  const dimensions = cleanDimensions(out.dimensions.value);
  put("dimensions", out.dimensions, dimensions ? formatDimensions(dimensions) : "");

  const tol = out.tolerance.value;
  const toleranceMm = tol !== null && tol > 0 && tol < 10 ? tol : null;
  put("tolerance", out.tolerance, toleranceMm ? `±${toleranceMm} mm` : "普通公差のみ");

  const surface = matchTreatment(textOf(out.surfaceTreatment.value), rates, "surface");
  put(
    "surfaceTreatment",
    out.surfaceTreatment,
    surface.id ? treatmentLabel(surface.id, rates) : textOf(out.surfaceTreatment.value) ?? "",
    surface.issue,
  );
  const heat = matchTreatment(textOf(out.heatTreatment.value), rates, "heat");
  put(
    "heatTreatment",
    out.heatTreatment,
    heat.id ? treatmentLabel(heat.id, rates) : textOf(out.heatTreatment.value) ?? "",
    heat.issue,
  );

  const dueDate = cleanDate(out.dueDate.value);
  put("dueDate", out.dueDate, dueDate ? formatJpDate(dueDate, true) : "");
  const inspection = textOf(out.inspection.value);
  put("inspection", out.inspection, inspection ?? "");

  const aiProcessType = PROCESS_TYPES.find((p) => p === out.processType.value) ?? null;
  const processType =
    aiProcessType ?? (dimensions?.shape === "round" ? "turning" : dimensions?.shape === "sheet" ? "sheet" : null);
  put("processType", out.processType, processType ? PROCESS_TYPE_LABEL[processType] : "");

  const spec: Spec = {
    customerId: customer?.id ?? null,
    customerName,
    contactName: textOf(out.contactName.value),
    partName,
    drawingNumber,
    revision,
    materialId: material.id,
    materialCandidates: material.candidates,
    quantity,
    dimensions,
    toleranceMm,
    surfaceTreatmentId: surface.id,
    surfaceTreatmentCandidates: surface.candidates,
    heatTreatmentId: heat.id,
    heatTreatmentCandidates: heat.candidates,
    dueDate,
    inspection,
    processType,
    features: out.features.map((f) => clip(f, 80)).filter((f): f is string => Boolean(f)).slice(0, 20),
    notes: out.notes.map((n) => clip(n, 160)).filter((n): n is string => Boolean(n)).slice(0, 20),
  };

  const aiQuestions: Question[] = out.questions
    .map((q) => ({
      field: [...FIELD_KEYS, "other"].includes(q.field) ? (q.field as Question["field"]) : ("other" as const),
      issue: clip(q.issue, 200) ?? "",
      question: clip(q.question, 300) ?? "",
      origin: "ai" as const,
    }))
    .filter((q) => q.question !== "")
    .slice(0, 15);

  return {
    summary: clip(out.summary, 300) ?? "",
    spec,
    fields: FIELD_KEYS.map((k) => fields.get(k)!),
    aiQuestions,
  };
}
