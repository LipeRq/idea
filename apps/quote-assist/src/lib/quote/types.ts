import { z } from "zod";
import { DimensionsSchema } from "../domain/reference";

// 工数・単価の出典。AI案、類似案件の実績からの計算、人の入力を区別して記録する
export const HoursSourceSchema = z.object({
  kind: z.enum(["ai", "fallback", "human"]),
  caseIds: z.array(z.string()),
  note: z.string().nullable(),
});
export type HoursSource = z.infer<typeof HoursSourceSchema>;

export const QuoteProcessInputSchema = z.object({
  processId: z.string(),
  setupHours: z.number().min(0).max(100),
  cycleHoursPerPiece: z.number().min(0).max(100),
  // 単価表のチャージを人が変えたときだけ入る
  chargeOverride: z.number().positive().max(100_000).nullable(),
  source: HoursSourceSchema,
});
export type QuoteProcessInput = z.infer<typeof QuoteProcessInputSchema>;

export const QuoteInputSchema = z.object({
  quantity: z.number().int().min(1).max(100_000),
  material: z.object({
    materialId: z.string(),
    dimensions: DimensionsSchema,
    pricePerKgOverride: z.number().positive().max(1_000_000).nullable(),
  }),
  processes: z.array(QuoteProcessInputSchema).max(20),
  treatments: z
    .array(
      z.object({
        treatmentId: z.string(),
        unitPriceOverride: z.number().positive().max(10_000_000).nullable(),
      }),
    )
    .max(5),
  profitRate: z.number().min(0).max(1),
  expedite: z.boolean(),
}).superRefine((input, ctx) => {
  // 同じ工程・処理が2回あると二重に計上されるため受け付けない(画面でも重複して追加できない)
  const dup = (ids: string[]) => ids.find((id, i) => ids.indexOf(id) !== i);
  const process = dup(input.processes.map((p) => p.processId));
  if (process) ctx.addIssue({ code: "custom", path: ["processes"], message: `工程が重複しています: ${process}` });
  const treatment = dup(input.treatments.map((t) => t.treatmentId));
  if (treatment) ctx.addIssue({ code: "custom", path: ["treatments"], message: `表面処理・熱処理が重複しています: ${treatment}` });
});
export type QuoteInput = z.infer<typeof QuoteInputSchema>;

/** 見積明細の数値がどこから来たか。画面では単価表や過去案件へのリンクになる */
export type QuoteRef =
  | { type: "material"; id: string }
  | { type: "process"; id: string; caseIds: string[]; sourceKind: HoursSource["kind"] }
  | { type: "treatment"; id: string }
  | { type: "rule"; key: string };

export type QuoteLineKind =
  | "material"
  | "process"
  | "setup"
  | "treatment"
  | "expedite"
  | "overhead"
  | "profit"
  | "rounding";

export type QuoteLine = {
  kind: QuoteLineKind;
  label: string;
  /** 計算式の説明(例:0.52kg × 50個 × 750円/kg) */
  basis: string;
  amount: number;
  ref: QuoteRef | null;
  /** 人が単価・工数を変えた明細 */
  overridden: boolean;
};

export type QuoteTier = { quantity: number; unitPrice: number; total: number };

export type QuoteResult = {
  quantity: number;
  /** 素材(取り代込み)の重量 */
  weightKgPerPiece: number;
  /** 仕上がり重量(重量単価の外注費に使う) */
  partWeightKgPerPiece: number;
  lines: QuoteLine[];
  directCost: number;
  overhead: number;
  profit: number;
  /** 端数処理前の合計 */
  rawTotal: number;
  unitPrice: number;
  total: number;
  /** 1個あたりの加工時間(数量係数を掛けた後) */
  hoursPerPiece: number;
  setupHours: number;
  quantityFactor: number;
  standardLeadDays: number;
  tiers: QuoteTier[];
};
