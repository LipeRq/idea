import { z } from "zod";
import { FIELD_KEYS } from "../domain/inquiry";
import { PROCESS_TYPES, SHAPES } from "../domain/reference";

// Claude に返させる抽出結果の構造。値はまだ正規化前(単価表のidではなく図面の表記)。
// デモモードの固定結果も同じ形にして、正規化以降の処理を共通にする。

const SourceSchema = z.object({
  document: z
    .string()
    .describe("根拠の文書。図面はファイル名、メールは「メール本文」または「メール件名」"),
  page: z.number().int().nullable().describe("図面のページ番号(1始まり)。メールは null"),
  location: z
    .string()
    .describe("文書内の位置。例:表題欄の材質欄、注記3、正面図の穴ピッチ寸法、メール本文の箇条書き"),
  quote: z.string().describe("根拠となる記載をそのまま引用する。40文字以内"),
});

const meta = {
  raw: z.string().nullable().describe("文書に書かれていた表記そのまま。記載がなければ null"),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe(
      "high=明記されていて読み違いの余地がない、medium=表記ゆれ・推定・一部判読困難を含む、low=記載がない・読み取れない・文書間で矛盾している",
    ),
  sources: z.array(SourceSchema).describe("根拠。図面とメールの両方に記載があれば両方。記載がなければ空"),
  note: z.string().nullable().describe("あいまいな点・矛盾・前提。なければ null"),
};

const text = (description: string) =>
  z.object({ value: z.string().nullable().describe(description), ...meta });

export const ExtractionOutputSchema = z.object({
  summary: z.string().describe("引き合いの要約。何を何個、いつまでに。1〜2文"),
  customerName: text("発注元の会社名(正式名称)"),
  contactName: text("発注元の担当者の部署と姓"),
  partName: text("品名"),
  drawingNumber: text("図番。版(リビジョン)は含めない"),
  revision: text("版(リビジョン)の記号。例:C"),
  material: text("材質。図面の表記どおり(例:SUS304、A5052、アルミ)"),
  quantity: z.object({
    value: z
      .number()
      .int()
      .nullable()
      .describe("数量(個)。「数個」「若干」のように数が決まっていなければ null"),
    ...meta,
  }),
  dimensions: z.object({
    value: z
      .object({
        shape: z.enum(SHAPES).describe("block=角物、round=丸物(軸・円筒)、sheet=板金の板物"),
        lengthMm: z.number().describe("長さ(mm)"),
        widthMm: z.number().nullable().describe("幅(mm)。丸物は null"),
        heightMm: z.number().nullable().describe("厚さ・高さ・板厚(mm)。丸物は null"),
        diameterMm: z.number().nullable().describe("最大直径(mm)。丸物以外は null"),
      })
      .nullable()
      .describe("外形寸法"),
    ...meta,
  }),
  tolerance: z.object({
    value: z
      .number()
      .nullable()
      .describe(
        "寸法公差のうち最も厳しいものの片側の幅(mm)。±0.01なら0.01、+0.015/0なら0.0075。普通公差しかなければ null",
      ),
    ...meta,
  }),
  surfaceTreatment: text(
    "表面処理。「なし」と明記されていれば「なし」、記載がなければ null。種類と膜厚・色を含めて書く",
  ),
  heatTreatment: text("熱処理。「なし」と明記されていれば「なし」、記載がなければ null。硬さの指定も含める"),
  dueDate: text("希望納期を YYYY-MM-DD で。年がなければ受付日以降で最も近い日付。記載がなければ null"),
  inspection: text("検査成績書・ミルシートなど提出書類の要求。不要と明記されていれば「不要」、記載がなければ null"),
  processType: z.object({
    value: z
      .enum(PROCESS_TYPES)
      .nullable()
      .describe("主な加工種別。milling=マシニングによる切削、turning=旋盤による旋削、sheet=板金"),
    ...meta,
  }),
  features: z
    .array(z.string())
    .describe("工数に影響する形状特徴。例:φ8H7リーマ穴×2、M5タップ×4、キー溝、ポケット加工、曲げ4か所"),
  notes: z.array(z.string()).describe("図面の注記・要求事項を番号順に短く"),
  questions: z
    .array(
      z.object({
        field: z.enum([...FIELD_KEYS, "other"]),
        issue: z.string().describe("確認が必要な理由。1文"),
        question: z.string().describe("顧客に送る質問文。丁寧な日本語で1〜2文"),
      }),
    )
    .describe("顧客への確認事項。不足・あいまい・矛盾している項目ごとに1つ。なければ空"),
});

export type ExtractionOutput = z.infer<typeof ExtractionOutputSchema>;
export type ExtractionTextField = ExtractionOutput["partName"];
