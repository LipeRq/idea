import { z } from "zod";
import { FIELD_KEYS, FIELD_LABEL, type FieldKey } from "./inquiry";

// 効果測定(導入前後の比較)で使う記録の型。
// 導入前は「PoC計画書 5章の記録シート」の1行、導入後は見積アシストのログ・記録から作る1件分を、
// どちらも同じ形(CaseRecord)にそろえてから、同じ計算式で集計する。

const YEAR_RANGE = (date: string) => {
  const year = Number(date.slice(0, 4));
  return year >= 2000 && year <= 2100;
};
/** YYYY-MM-DD(2000〜2100年) */
export const IsoDate = z.iso.date().refine(YEAR_RANGE, { message: "日付は2000〜2100年で入力してください" });

// ---- AI案の項目(採用率・修正率の集計単位) ----

export const QUOTE_ITEM_KEYS = [
  "quote:material",
  "quote:quantity",
  "quote:hours",
  "quote:treatments",
  "quote:profitRate",
  "quote:expedite",
] as const;
export type QuoteItemKey = (typeof QUOTE_ITEM_KEYS)[number];

export const ADOPTION_ITEM_KEYS: readonly string[] = [...FIELD_KEYS.map((k) => `field:${k}`), ...QUOTE_ITEM_KEYS];
export type AdoptionItemKey = `field:${FieldKey}` | QuoteItemKey;

const QUOTE_ITEM_LABEL: Record<QuoteItemKey, string> = {
  "quote:material": "材質",
  "quote:quantity": "数量",
  "quote:hours": "工程の工数(段取り・1個あたり)",
  "quote:treatments": "表面処理・熱処理",
  "quote:profitRate": "利益率",
  "quote:expedite": "特急料金",
};

export function adoptionItemLabel(key: string): string {
  if (key.startsWith("field:")) return FIELD_LABEL[key.slice(6) as FieldKey] ?? key;
  return QUOTE_ITEM_LABEL[key as QuoteItemKey] ?? key;
}

export function adoptionItemGroup(key: string): "extraction" | "quote" {
  return key.startsWith("field:") ? "extraction" : "quote";
}

export const ADOPTION_GROUP_LABEL = {
  extraction: "図面・メールの読み取り(抽出項目)",
  quote: "見積の項目(工数案・条件)",
} as const;

// ---- 1件分の記録(集計の入力) ----

export const CaseRecordSchema = z.object({
  id: z.string().min(1).max(100),
  /** 受付日(日本時間の暦日) */
  receivedAt: IsoDate,
  /** 回答日。見積アシストでは承認した日(回答の送信は人が行うため)。未回答は null */
  answeredAt: IsoDate.nullable(),
  /** 見積を作った人 */
  operator: z.string().max(50).nullable(),
  /** 1件あたりの作業時間(分)。導入前は記録シートの合計、導入後は登録〜承認の経過時間 */
  workMinutes: z.number().min(0).max(100_000).nullable(),
  aiUsed: z.boolean(),
  aiCostJpy: z.number().min(0).nullable(),
  aiProcessingMs: z.number().min(0).nullable(),
  aiTokens: z.number().min(0).nullable(),
  /** 項目ごとの「評価した数」と「人が修正した数」 */
  adoption: z
    .array(
      z
        .object({
          item: z.string().refine((k) => ADOPTION_ITEM_KEYS.includes(k), { message: "未知の項目です" }),
          evaluated: z.number().int().min(0),
          modified: z.number().int().min(0),
        })
        .refine((a) => a.modified <= a.evaluated, { message: "修正数が評価数を超えています" }),
    )
    .max(40),
  /** 人が修正した工程の、1個あたり時間の修正幅(|修正後−案|÷案) */
  hourChangeRates: z.array(z.number().min(0)).max(100),
  result: z.enum(["won", "lost"]).nullable(),
  /** 受注額(税抜・円) */
  orderAmount: z.number().min(0).nullable(),
  /** 見積原価(利益・端数処理を除く) */
  quotedCost: z.number().min(0).nullable(),
  actualCost: z.number().min(0).nullable(),
  reworkCount: z.number().int().min(0).nullable(),
});
export type CaseRecord = z.infer<typeof CaseRecordSchema>;

/** デモ用の架空の導入後記録(data/impact-pilot.json) */
export const PilotFileSchema = z.object({
  note: z.string(),
  records: z.array(CaseRecordSchema).max(5000),
});
export type PilotFile = z.infer<typeof PilotFileSchema>;

// ---- ベースライン(PoC計画書 5章の記録シート) ----

export const REQUEST_KINDS = ["new", "repeat", "revision"] as const;
export const REQUEST_KIND_LABEL: Record<(typeof REQUEST_KINDS)[number], string> = {
  new: "新規",
  repeat: "リピート",
  revision: "改訂",
};

const minutes = z.number().min(0).max(10_000).nullable();
const money = z.number().min(0).max(1_000_000_000).nullable();

export const BaselineRowSchema = z.object({
  receivedAt: IsoDate,
  customer: z.string().max(100),
  partName: z.string().max(100),
  kind: z.enum(REQUEST_KINDS).nullable(),
  drawingCount: z.number().int().min(0).max(999).nullable(),
  estimator: z.string().max(50),
  salesMinutes: minutes,
  estimatorMinutes: minutes,
  answeredAt: IsoDate.nullable(),
  customerInquiry: z.boolean().nullable(),
  result: z.enum(["won", "lost"]).nullable(),
  memo: z.string().max(200),
  // 記録シートにない任意の列(見積と実績の差・手戻りを導入前と比べるとき)
  orderAmount: money,
  quotedCost: money,
  actualCost: money,
  reworkCount: z.number().int().min(0).max(999).nullable(),
});
export type BaselineRow = z.infer<typeof BaselineRowSchema>;

export const MAX_BASELINE_ROWS = 1000;

export const BaselineSchema = z.object({
  /** 「見積担当者」として数える人(部分一致)。それ以外の人が作成したものを「見積担当者以外」とする */
  estimators: z.array(z.string().trim().min(1).max(50)).max(20),
  note: z.string().max(300),
  rows: z.array(BaselineRowSchema).max(MAX_BASELINE_ROWS),
  updatedAt: z.iso.datetime(),
});
export type Baseline = z.infer<typeof BaselineSchema>;

/** 画面からの保存(更新日時はサーバーで付ける) */
export const BaselineInputSchema = BaselineSchema.omit({ updatedAt: true });
export type BaselineInput = z.infer<typeof BaselineInputSchema>;

/** デモ用の架空のベースライン(data/impact-baseline.json) */
export const BaselineFileSchema = BaselineInputSchema;
