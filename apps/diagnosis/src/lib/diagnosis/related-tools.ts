// 診断結果からの「あわせて使えるツール」の案内。
// 入力(業種・業務の時間・準備度・優先したいこと・いま困っていること)から、決まったルールで選ぶ(AIには判断させない)。
// 文言・しきい値・キーワードはここで調整する。案内は参考情報で、効果を保証するものではない。

import { GOALS, type TaskId } from "./master";
import type { DiagnosisInput } from "./schema";

export const RELATED_TOOL_IDS = ["inventoryTool", "quoteAssistDemo"] as const;

export type RelatedToolId = (typeof RELATED_TOOL_IDS)[number];

/** 案内のリンク先(環境変数)。未設定の案内は「無料相談でご案内します」として相談フォームへ誘導する */
export type RelatedToolUrls = Partial<Record<RelatedToolId, string>>;

export type RelatedToolMaster = {
  title: string;
  description: string;
  /** リンク先が設定されているときのリンクの文言 */
  linkLabel: string;
  /** 相談フォームの「相談したいテーマ」に出し、選ぶと「相談したい内容」の欄に入る文言 */
  leadTopic: string;
  /** 相談フォームへ誘導するボタンの文言 */
  leadButtonLabel: string;
  /** リンク先があっても相談フォームへのボタンを出すか(面談で実演するデモなど) */
  alwaysOfferLead: boolean;
};

export const RELATED_TOOLS = {
  inventoryTool: {
    title: "Excelマクロ・Accessの中身を調べる無料ツール",
    description:
      "Excelマクロ(VBA)・Accessのファイルを、お使いのブラウザの中だけで解析し、仕様書・処理の流れ・リスク・移行の目安をまとめます。標準の解析ではファイルをサーバーに送信しません。",
    linkLabel: "無料ツールを開く",
    leadTopic: "Excelマクロ・Accessの中身の確認・移行の相談",
    leadButtonLabel: "相談フォームへ",
    alwaysOfferLead: false,
  },
  quoteAssistDemo: {
    title: "製造業向け見積アシストのデモ(面談で実演)",
    description:
      "部品加工の見積を想定し、引き合いメールと図面から要件と確認事項を整理して、過去の類似案件と単価表をもとに見積書のたたき台を作る仕組みです。社外には公開していないため、無料相談の面談で実演します。",
    linkLabel: "デモの紹介を見る",
    leadTopic: "見積アシストのデモ希望",
    leadButtonLabel: "無料相談でデモを申し込む",
    alwaysOfferLead: true,
  },
} as const satisfies Record<RelatedToolId, RelatedToolMaster>;

// ---- 案内のルール(しきい値・キーワード) ----

/** 「いま困っていること」の Excel・マクロ・VBA・Access・属人化・引き継ぎ の兆候(NFKC・小文字にそろえて部分一致) */
export const INVENTORY_KEYWORDS = [
  "excel",
  "エクセル",
  "xls",
  "マクロ",
  "vba",
  "access",
  "属人",
  "引き継",
  "引継",
  "ひきつぎ",
] as const;

/** データ入力・転記と集計・分析の工数(月・合計)がこの時間以上 */
export const INVENTORY_DATA_WORK_HOURS = 40;
export const INVENTORY_DATA_WORK_TASKS = ["dataEntry", "reporting"] as const satisfies readonly TaskId[];

/** 準備度「業務データの主な保存場所」がこの段階以下(0:紙の書類が中心、1:個人PCのExcel・Wordが中心) */
export const INVENTORY_DATA_LOCATION_MAX = 1;

/** 優先したいことの「属人化の解消」と、保存場所「個人PCのExcel・Wordが中心」(1)の組み合わせ */
export const INVENTORY_GOAL = "属人化の解消" satisfies (typeof GOALS)[number];
export const DATA_LOCATION_PERSONAL_PC = 1;

export const QUOTE_INDUSTRY = "製造業";
/** 見積書・提案書の作成の工数(月)がこの時間以上 */
export const QUOTE_DOCUMENT_HOURS = 20;
export const QUOTE_KEYWORDS = ["見積", "みつもり", "積算"] as const;

/** 案内の理由(画面とPDFに出す)。入力した文章は引用しない */
export const RELATED_TOOL_REASONS = {
  inventoryKeyword:
    "「いま困っていること」に、Excel・マクロ・Accessや、属人化・引き継ぎに関する記述がありました。",
  inventoryDataWork: `データ入力・転記と集計・分析に月${INVENTORY_DATA_WORK_HOURS}時間以上かかり、業務データの保存場所が紙や個人PCのExcelが中心とのご回答でした。`,
  inventoryGoal:
    "「属人化の解消」を優先したいとのご回答で、業務データが個人PCのExcel・Wordに置かれていることが多いとのご回答でした。",
  quoteDocumentHours: `製造業で、見積書・提案書の作成に月${QUOTE_DOCUMENT_HOURS}時間以上かかっているとのご回答でした。`,
  quoteKeyword: "製造業で、「いま困っていること」に見積に関する記述がありました。",
} as const;

export type RelatedToolReasonId = keyof typeof RELATED_TOOL_REASONS;

export type RelatedToolRecommendation = RelatedToolMaster & {
  id: RelatedToolId;
  reasonIds: RelatedToolReasonId[];
  reasons: string[];
};

function normalize(text: string | undefined): string {
  return (text ?? "").normalize("NFKC").toLowerCase();
}

function containsAny(text: string, keywords: readonly string[]): boolean {
  return keywords.some((k) => text.includes(k));
}

/** 案内する関連ツールと、その理由(該当したルールすべて)。どれにも当てはまらなければ空 */
export function recommendRelatedTools(input: DiagnosisInput): RelatedToolRecommendation[] {
  const challenges = normalize(input.challenges);
  const hours = (id: TaskId) => input.taskHours[id] ?? 0;
  const dataLocation = input.readiness.dataLocation;

  const matched: Record<RelatedToolId, RelatedToolReasonId[]> = {
    inventoryTool: [],
    quoteAssistDemo: [],
  };

  if (containsAny(challenges, INVENTORY_KEYWORDS)) {
    matched.inventoryTool.push("inventoryKeyword");
  }
  const dataWorkHours = INVENTORY_DATA_WORK_TASKS.reduce((sum, id) => sum + hours(id), 0);
  if (dataWorkHours >= INVENTORY_DATA_WORK_HOURS && dataLocation <= INVENTORY_DATA_LOCATION_MAX) {
    matched.inventoryTool.push("inventoryDataWork");
  }
  if (input.goals.includes(INVENTORY_GOAL) && dataLocation === DATA_LOCATION_PERSONAL_PC) {
    matched.inventoryTool.push("inventoryGoal");
  }

  if (input.industry === QUOTE_INDUSTRY) {
    if (hours("documents") >= QUOTE_DOCUMENT_HOURS) {
      matched.quoteAssistDemo.push("quoteDocumentHours");
    }
    if (containsAny(challenges, QUOTE_KEYWORDS)) {
      matched.quoteAssistDemo.push("quoteKeyword");
    }
  }

  return RELATED_TOOL_IDS.flatMap((id) =>
    matched[id].length === 0
      ? []
      : [
          {
            id,
            ...RELATED_TOOLS[id],
            reasonIds: matched[id],
            reasons: matched[id].map((r) => RELATED_TOOL_REASONS[r]),
          },
        ],
  );
}
