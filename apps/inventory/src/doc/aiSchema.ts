import { z } from "zod";

// Claude に返させる構造。件数・行数などの数値は含めず、文章だけを書かせる。
// 「高・中・低」などの区分は、多少の表記ゆれで全体が失敗しないよう文字列で受け取り、後で正規化する。

const LEVEL = "「高」「中」「低」のいずれか1文字";

export const ModuleSummariesSchema = z.object({
  modules: z.array(
    z.object({
      moduleName: z.string().describe("入力の name 属性をそのまま書く"),
      purpose: z.string().describe("このモジュール(またはその部分)が業務上何をしているか。1〜2文。"),
      procedures: z
        .array(
          z.object({
            name: z.string().describe("プロシージャ名(クエリ名)をそのまま書く"),
            summary: z.string().describe("処理内容。1文。"),
          }),
        )
        .describe("指定されたプロシージャすべてについて書く"),
      concerns: z.array(z.string()).describe("保守・移行で気になる点(属人的な前提、ハードコード、エラー処理など)。なければ空配列。"),
    }),
  ),
});
export type ModuleSummaries = z.infer<typeof ModuleSummariesSchema>;

export const AiOverallSchema = z.object({
  overview: z.string().describe("このファイルが何のための仕組みで、誰がどんな場面で使うと推定されるか。3〜5文。"),
  businessFlow: z.object({
    summary: z.string().describe("業務の流れの説明。2〜4文。"),
    steps: z
      .array(
        z.object({
          id: z.string().describe("s1, s2 のような短いID"),
          label: z.string().describe("作業や処理の名前。20文字程度。"),
          actor: z.string().describe("「利用者」「マクロ」「外部システム」のいずれか"),
          next: z.array(z.string()).describe("次に進むステップのID。最後なら空配列。"),
        }),
      )
      .describe("3〜12ステップ"),
  }),
  risks: z
    .array(
      z.object({
        title: z.string(),
        severity: z.string().describe(`重要度。${LEVEL}`),
        detail: z.string().describe("なぜ問題か。経営者に伝わる言葉で2文程度。"),
        ruleIds: z.array(z.string()).describe("関連する機械検出リスクの ruleId。なければ空配列。"),
        recommendation: z.string().describe("対策。1〜2文。"),
      }),
    )
    .describe("重要な順に3〜8件"),
  migrations: z
    .array(
      z.object({
        target: z.string().describe("移行先の種類と代表例(例: ノーコード業務アプリ(kintone等)、Python、Power Automate、業務SaaS)"),
        fit: z.string().describe(`このファイルへの適合度。${LEVEL}`),
        difficulty: z.string().describe(`移行の難易度。${LEVEL}`),
        reason: z.string().describe("候補に挙げる理由。1〜2文。"),
        approach: z.string().describe("進め方。2〜3文。"),
        concerns: z.string().describe("注意点。1文。"),
      }),
    )
    .describe("2〜4件。適合度の高い順。"),
  recommendation: z.string().describe("総合的なおすすめの進め方。2〜3文。"),
  hearingItems: z.array(z.string()).describe("現場の担当者に確認すべき質問。3〜8個。"),
});
export type AiOverallRaw = z.infer<typeof AiOverallSchema>;

export type Level = "高" | "中" | "低";
export type Actor = "利用者" | "マクロ" | "外部システム";

/** 区分を正規化した後の AI の文章 */
export interface AiOverall extends Omit<AiOverallRaw, "businessFlow" | "risks" | "migrations"> {
  businessFlow: { summary: string; steps: (Omit<AiOverallRaw["businessFlow"]["steps"][number], "actor"> & { actor: Actor })[] };
  risks: (Omit<AiOverallRaw["risks"][number], "severity"> & { severity: Level })[];
  migrations: (Omit<AiOverallRaw["migrations"][number], "fit" | "difficulty"> & { fit: Level; difficulty: Level })[];
}

export function toLevel(s: string): Level {
  return s.includes("高") ? "高" : s.includes("低") ? "低" : "中";
}

export function toActor(s: string): Actor {
  return s.includes("利用") ? "利用者" : s.includes("外部") ? "外部システム" : "マクロ";
}

export interface ModuleNarrative {
  purpose: string;
  concerns: string[];
  procedures: Map<string, string>;
}

/** AI が書いた文章一式。Markdown に差し込む */
export interface AiDocument {
  modules: Map<string, ModuleNarrative>;
  overall: AiOverall;
  /** AI への入力で要約・省略したことなどの注記 */
  notes: string[];
}
