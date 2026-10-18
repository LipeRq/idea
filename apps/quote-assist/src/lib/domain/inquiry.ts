import { z } from "zod";
import { DimensionsSchema, PROCESS_TYPES } from "./reference";
import { QuoteInputSchema } from "../quote/types";

export const FIELD_KEYS = [
  "customerName",
  "partName",
  "drawingNumber",
  "revision",
  "material",
  "quantity",
  "dimensions",
  "tolerance",
  "surfaceTreatment",
  "heatTreatment",
  "dueDate",
  "inspection",
  "processType",
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

export const FIELD_LABEL: Record<FieldKey, string> = {
  customerName: "顧客",
  partName: "品名",
  drawingNumber: "図番",
  revision: "版",
  material: "材質",
  quantity: "数量",
  dimensions: "外形寸法",
  tolerance: "最小公差",
  surfaceTreatment: "表面処理",
  heatTreatment: "熱処理",
  dueDate: "希望納期",
  inspection: "検査書類",
  processType: "加工種別",
};

export const CONFIDENCES = ["high", "medium", "low"] as const;
export type Confidence = (typeof CONFIDENCES)[number];
export const CONFIDENCE_LABEL: Record<Confidence, string> = { high: "高", medium: "中", low: "低" };

export const SourceSchema = z.object({
  document: z.string(),
  page: z.number().int().nullable(),
  location: z.string(),
  quote: z.string(),
});
export type Source = z.infer<typeof SourceSchema>;

/** 見積・検索に使う、正規化済みの引き合い仕様 */
export const SpecSchema = z.object({
  customerId: z.string().nullable(),
  customerName: z.string().nullable(),
  contactName: z.string().nullable(),
  partName: z.string().nullable(),
  drawingNumber: z.string().nullable(),
  revision: z.string().nullable(),
  materialId: z.string().nullable(),
  // 材質が系統だけ分かる(「アルミ」など)ときの候補。先頭を仮計算に使う
  materialCandidates: z.array(z.string()),
  quantity: z.number().int().positive().nullable(),
  dimensions: DimensionsSchema.nullable(),
  toleranceMm: z.number().positive().nullable(),
  // 単価表の処理id、"none"(なしと明記)、null(記載なし)
  surfaceTreatmentId: z.string().nullable(),
  surfaceTreatmentCandidates: z.array(z.string()),
  heatTreatmentId: z.string().nullable(),
  heatTreatmentCandidates: z.array(z.string()),
  dueDate: z.iso.date().nullable(),
  inspection: z.string().nullable(),
  processType: z.enum(PROCESS_TYPES).nullable(),
  features: z.array(z.string()),
  notes: z.array(z.string()),
});
export type Spec = z.infer<typeof SpecSchema>;

export const FieldStatusSchema = z.enum(["ok", "review", "missing"]);
export type FieldStatus = z.infer<typeof FieldStatusSchema>;

export const ExtractedFieldSchema = z.object({
  key: z.enum(FIELD_KEYS),
  display: z.string(),
  raw: z.string().nullable(),
  confidence: z.enum(CONFIDENCES),
  sources: z.array(SourceSchema),
  status: FieldStatusSchema,
  note: z.string().nullable(),
  // 正規化・ルールで見つかった問題(単価表にない材質、あいまいな処理名、過去の納期など)
  issue: z.string().nullable(),
  required: z.boolean(),
  editedByHuman: z.boolean(),
});
export type ExtractedField = z.infer<typeof ExtractedFieldSchema>;

export const QuestionSchema = z.object({
  field: z.union([z.enum(FIELD_KEYS), z.literal("other")]),
  issue: z.string(),
  question: z.string(),
  origin: z.enum(["ai", "rule"]),
});
export type Question = z.infer<typeof QuestionSchema>;

export const UsageSchema = z.object({
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  cacheCreationInputTokens: z.number().int().min(0),
  cacheReadInputTokens: z.number().int().min(0),
});
export type Usage = z.infer<typeof UsageSchema>;

export const STEP_LABEL = {
  extract: "図面・メールの読み取り",
  rules: "正規化・必須項目チェック",
  search: "類似案件の検索",
  estimate: "工数案の作成",
  calculate: "見積計算",
} as const;
export type StepName = keyof typeof STEP_LABEL;

export const StepMetricSchema = z.object({
  step: z.enum(Object.keys(STEP_LABEL) as [StepName, ...StepName[]]),
  mode: z.enum(["ai", "demo", "rule", "fallback"]),
  durationMs: z.number().min(0),
  model: z.string().nullable(),
  usage: UsageSchema.nullable(),
  costUsd: z.number().min(0).nullable(),
  at: z.iso.datetime(),
});
export type StepMetric = z.infer<typeof StepMetricSchema>;

export const SimilarCaseSchema = z.object({
  caseId: z.string(),
  score: z.number(),
  breakdown: z.array(z.object({ factor: z.string(), label: z.string(), points: z.number(), max: z.number() })),
  reasons: z.array(z.string()),
  aiReason: z.string().nullable(),
  warnings: z.array(z.string()),
});
export type SimilarCase = z.infer<typeof SimilarCaseSchema>;

export const ReviewLogEntrySchema = z.object({
  at: z.iso.datetime(),
  kind: z.enum(["field", "quote"]),
  key: z.string(),
  label: z.string(),
  before: z.string(),
  after: z.string(),
});
export type ReviewLogEntry = z.infer<typeof ReviewLogEntrySchema>;

export const ProcessRationaleSchema = z.object({
  processId: z.string(),
  rationale: z.string(),
});

export const InquirySchema = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  status: z.enum(["extracted", "estimated", "approved", "registered"]),
  email: z.object({
    from: z.string(),
    subject: z.string(),
    body: z.string(),
  }),
  drawings: z.array(
    z.object({
      id: z.string(),
      fileName: z.string(),
      sizeBytes: z.number().int().min(0),
      sha256: z.string(),
      blobKey: z.string(),
    }),
  ),
  extraction: z.object({
    mode: z.enum(["ai", "demo", "failed"]),
    summary: z.string(),
    spec: SpecSchema,
    fields: z.array(ExtractedFieldSchema),
    // AIが作った質問文の案(手修正のあとで確認事項を作り直すために残す)
    aiQuestions: z.array(QuestionSchema),
    questions: z.array(QuestionSchema),
    error: z.string().nullable(),
  }),
  similar: z
    .object({ mode: z.enum(["ai", "rule"]), cases: z.array(SimilarCaseSchema) })
    .nullable(),
  estimate: z
    .object({
      mode: z.enum(["ai", "fallback"]),
      proposal: QuoteInputSchema,
      rationales: z.array(ProcessRationaleSchema),
      risks: z.array(z.string()),
      memo: z.string(),
      // 仮の値で計算した項目(材質・数量・寸法が未確定など)
      assumptions: z.array(z.string()),
    })
    .nullable(),
  quote: z.object({ input: QuoteInputSchema, updatedAt: z.iso.datetime() }).nullable(),
  approved: z
    .object({
      at: z.iso.datetime(),
      quoteNumber: z.string(),
      rateTableId: z.string(),
      input: QuoteInputSchema,
      unitPrice: z.number().int(),
      total: z.number().int(),
      standardLeadDays: z.number().int(),
      weightKgPerPiece: z.number(),
      // 承認した時点の明細(あとで単価表が変わっても、承認した見積の内容は変えない)
      lines: z.array(z.object({ kind: z.string(), label: z.string(), basis: z.string(), amount: z.number().int() })),
      tiers: z.array(z.object({ quantity: z.number().int(), unitPrice: z.number().int(), total: z.number().int() })),
    })
    .nullable(),
  reviewLog: z.array(ReviewLogEntrySchema),
  metrics: z.array(StepMetricSchema),
  crm: z
    .object({
      provider: z.enum(["mock", "salesforce"]),
      opportunityId: z.string(),
      quoteId: z.string(),
      opportunityUrl: z.string().nullable(),
      registeredAt: z.iso.datetime(),
    })
    .nullable(),
});
export type Inquiry = z.infer<typeof InquirySchema>;

export const INQUIRY_STATUS_LABEL: Record<Inquiry["status"], string> = {
  extracted: "抽出済み",
  estimated: "見積作成中",
  approved: "承認済み",
  registered: "CRM登録済み",
};
