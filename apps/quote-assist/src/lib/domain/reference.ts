import { z } from "zod";

// 参照データ(単価表・顧客・過去案件など)の型。data/*.json を差し替えて使うため、読み込み時に必ず検証する。

export const MATERIAL_GROUPS = ["steel", "stainless", "aluminum", "copper"] as const;
export type MaterialGroup = (typeof MATERIAL_GROUPS)[number];
export const MATERIAL_GROUP_LABEL: Record<MaterialGroup, string> = {
  steel: "鉄系",
  stainless: "ステンレス系",
  aluminum: "アルミ系",
  copper: "銅合金",
};

export const PROCESS_TYPES = ["milling", "turning", "sheet"] as const;
export type ProcessType = (typeof PROCESS_TYPES)[number];
export const PROCESS_TYPE_LABEL: Record<ProcessType, string> = {
  milling: "切削(マシニング)",
  turning: "旋削",
  sheet: "板金",
};

// 角物(長さ×幅×厚さ)、丸物(直径×長さ)、板物(長さ×幅×板厚)
export const SHAPES = ["block", "round", "sheet"] as const;
export type Shape = (typeof SHAPES)[number];
export const SHAPE_LABEL: Record<Shape, string> = {
  block: "角物",
  round: "丸物",
  sheet: "板物",
};

/** 表面処理・熱処理が「なし」と明記されている場合の値(null は「記載なし=不明」) */
export const NO_TREATMENT = "none";

const positive = z.number().positive();

export const DimensionsSchema = z
  .object({
    shape: z.enum(SHAPES),
    lengthMm: positive,
    widthMm: positive.nullable(),
    heightMm: positive.nullable(),
    diameterMm: positive.nullable(),
  })
  .refine(
    (d) => (d.shape === "round" ? d.diameterMm !== null : d.widthMm !== null && d.heightMm !== null),
    { message: "形状に必要な寸法がありません" },
  );
export type Dimensions = z.infer<typeof DimensionsSchema>;

export const ProcessRateSchema = z.object({
  id: z.string(),
  name: z.string(),
  chargePerHour: positive,
  setupChargePerHour: positive,
  types: z.array(z.enum(PROCESS_TYPES)),
  note: z.string().optional(),
});
export type ProcessRate = z.infer<typeof ProcessRateSchema>;

export const MaterialRateSchema = z.object({
  id: z.string(),
  name: z.string(),
  group: z.enum(MATERIAL_GROUPS),
  aliases: z.array(z.string()),
  densityGPerCm3: positive,
  pricePerKg: positive,
  minChargePerLot: z.number().min(0),
});
export type MaterialRate = z.infer<typeof MaterialRateSchema>;

export const TreatmentRateSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["surface", "heat"]),
  aliases: z.array(z.string()),
  pricing: z.enum(["per_kg", "per_piece"]),
  unitPrice: positive,
  minLotCharge: z.number().min(0),
  leadDays: z.number().int().min(0),
  materialGroups: z.array(z.enum(MATERIAL_GROUPS)),
});
export type TreatmentRate = z.infer<typeof TreatmentRateSchema>;

const AllowanceSchema = z.object({
  lengthMm: z.number().min(0),
  widthMm: z.number().min(0),
  heightMm: z.number().min(0),
  diameterMm: z.number().min(0),
});

export const RateTableSchema = z.object({
  id: z.string(),
  name: z.string(),
  updatedAt: z.iso.date(),
  processes: z.array(ProcessRateSchema).min(1),
  materials: z.array(MaterialRateSchema).min(1),
  treatments: z.array(TreatmentRateSchema),
  rules: z.object({
    overheadRate: z.number().min(0).max(1),
    defaultProfitRate: z.number().min(0).max(1),
    blankAllowanceMm: z.record(z.enum(SHAPES), AllowanceSchema),
    // minQty 以上の数量で、1個あたり加工時間に factor を掛ける(量産効果)
    quantityBreaks: z
      .array(z.object({ minQty: z.number().int().min(1), factor: z.number().positive().max(1) }))
      .min(1),
    quantityTiers: z.array(z.number().int().positive()).min(1),
    leadTime: z.object({
      baseDays: z.number().int().min(0),
      extraDaysPer50Pieces: z.number().int().min(0),
    }),
    expedite: z.object({ surchargeRate: z.number().min(0).max(2) }),
    rounding: z.object({ unitStepYen: z.number().int().positive() }),
    taxRate: z.number().min(0).max(1),
    quoteValidityDays: z.number().int().positive(),
    // 類似案件の単価からこの割合以上離れたら警告する
    priceDeviationWarnRate: z.number().positive(),
    // 単価表の更新日からこの日数を過ぎたら警告する
    staleAfterDays: z.number().int().positive(),
  }),
});
export type RateTable = z.infer<typeof RateTableSchema>;

export const CustomerSchema = z.object({
  id: z.string(),
  name: z.string(),
  shortName: z.string(),
  industry: z.string(),
  yearsOfBusiness: z.number().int().min(0),
  paymentTerms: z.string(),
  emailDomains: z.array(z.string()),
  drawingPrefix: z.string(),
  salesforceAccountId: z.string().nullable(),
});
export type Customer = z.infer<typeof CustomerSchema>;

export const ProcessHoursSchema = z.object({
  processId: z.string(),
  setupHours: z.number().min(0),
  cycleHoursPerPiece: z.number().min(0),
});
export type ProcessHours = z.infer<typeof ProcessHoursSchema>;

export const PastCaseSchema = z.object({
  id: z.string(),
  quotedAt: z.iso.date(),
  customerId: z.string(),
  drawingNumber: z.string(),
  revision: z.string(),
  partName: z.string(),
  processType: z.enum(PROCESS_TYPES),
  dimensions: DimensionsSchema,
  materialId: z.string(),
  weightKg: z.number().positive(),
  toleranceMm: z.number().positive(),
  surfaceTreatmentId: z.string().nullable(),
  heatTreatmentId: z.string().nullable(),
  features: z.array(z.string()),
  notes: z.string(),
  quantity: z.number().int().positive(),
  estimatedProcesses: z.array(ProcessHoursSchema),
  // 受注して製作した案件だけ実績がある
  actualProcesses: z.array(ProcessHoursSchema).nullable(),
  unitPrice: z.number().int().positive(),
  amount: z.number().int().positive(),
  result: z.enum(["won", "lost", "pending"]),
  lostReason: z.string().nullable(),
  responseDays: z.number().int().min(0),
  defectIds: z.array(z.string()),
});
export type PastCase = z.infer<typeof PastCaseSchema>;

export const DefectSchema = z.object({
  id: z.string(),
  caseId: z.string(),
  drawingNumber: z.string(),
  date: z.iso.date(),
  category: z.string(),
  description: z.string(),
  countermeasure: z.string(),
});
export type Defect = z.infer<typeof DefectSchema>;

export const CompanySchema = z.object({
  name: z.string(),
  description: z.string(),
  employees: z.number().int().positive(),
  quoteStaff: z.array(z.string()),
  // 見積書・メールの差出人
  salesContact: z.string(),
  address: z.string(),
  phone: z.string(),
  equipment: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      processId: z.string(),
      count: z.number().int().positive(),
      // 加工できる最大の大きさ(角物はストローク、丸物は振り・長さ)
      maxLengthMm: z.number().positive(),
      maxWidthMm: z.number().positive().nullable(),
      maxHeightMm: z.number().positive().nullable(),
      maxDiameterMm: z.number().positive().nullable(),
    }),
  ),
});
export type Company = z.infer<typeof CompanySchema>;

export const BacklogItemSchema = z.object({
  id: z.string(),
  receivedAt: z.iso.date(),
  customerName: z.string(),
  partName: z.string(),
  quantity: z.number().int().positive(),
  status: z.enum(["president_review", "waiting_customer", "answered"]),
  assignee: z.string(),
});
export type BacklogItem = z.infer<typeof BacklogItemSchema>;

export const BACKLOG_STATUS_LABEL: Record<BacklogItem["status"], string> = {
  president_review: "社長の確認待ち",
  waiting_customer: "顧客の回答待ち",
  answered: "回答済み",
};
