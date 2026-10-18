// 診断のマスターデータ。
// 削減率・費用の目安はコンサルタントの知見で調整する前提の初期値。
// 数値を変えると試算ロジック全体に反映される。

export const INDUSTRIES = [
  "製造業",
  "建設業",
  "卸売・小売業",
  "不動産業",
  "運輸・物流業",
  "医療・介護・福祉",
  "士業・コンサルティング",
  "IT・情報通信業",
  "人材・派遣業",
  "飲食・宿泊・サービス業",
  "その他",
] as const;

export const EMPLOYEE_BANDS = [
  "1〜10名",
  "11〜30名",
  "31〜100名",
  "101〜300名",
  "301名以上",
] as const;

export const GOALS = [
  "コスト削減",
  "人手不足への対応",
  "売上・受注の拡大",
  "属人化の解消",
  "品質向上・ミス削減",
] as const;

export type Difficulty = 1 | 2 | 3;

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  1: "低",
  2: "中",
  3: "高",
};

// 難易度ごとの導入費用の目安(円)。自社の料金表に合わせて調整する。
export const COST_BY_DIFFICULTY: Record<
  Difficulty,
  { initial: number; monthly: number }
> = {
  1: { initial: 100_000, monthly: 10_000 },
  2: { initial: 500_000, monthly: 30_000 },
  3: { initial: 1_500_000, monthly: 50_000 },
};

// 優先度計算で難易度をどれだけ割り引くか
export const DIFFICULTY_PENALTY: Record<Difficulty, number> = {
  1: 1,
  2: 1.6,
  3: 2.5,
};

export const READINESS_QUESTIONS = [
  {
    id: "dataLocation",
    label: "業務データの主な保存場所",
    weight: 25,
    options: [
      "紙の書類が中心",
      "個人PCのExcel・Wordが中心",
      "共有フォルダ・クラウドストレージで共有",
      "業務システム・SaaSで一元管理",
    ],
  },
  {
    id: "manuals",
    label: "業務手順の文書化",
    weight: 15,
    options: [
      "ほとんどない",
      "一部の業務だけある",
      "主要な業務はある",
      "定期的に更新している",
    ],
  },
  {
    id: "aiUsage",
    label: "生成AIの利用状況",
    weight: 15,
    options: [
      "使っていない",
      "個人が自己判断で使っている",
      "一部の部署で導入している",
      "全社で導入している",
    ],
  },
  {
    id: "itStaff",
    label: "社内のIT担当者",
    weight: 15,
    options: [
      "いない",
      "他の業務と兼任",
      "専任がいる",
      "専任がいて外部パートナーもいる",
    ],
  },
  {
    id: "rules",
    label: "AI利用のルール・セキュリティ方針",
    weight: 10,
    options: [
      "ない",
      "検討中",
      "簡易的なルールがある",
      "ガイドラインと研修まで整備",
    ],
  },
  {
    id: "leadership",
    label: "経営層の関与",
    weight: 20,
    options: [
      "関心が薄い",
      "関心はあるが方針は未定",
      "方針があり担当者を決めている",
      "経営課題として予算化している",
    ],
  },
] as const;

export type ReadinessId = (typeof READINESS_QUESTIONS)[number]["id"];

export const READINESS_IDS = READINESS_QUESTIONS.map((q) => q.id) as [
  ReadinessId,
  ...ReadinessId[],
];

export type TaskMaster = {
  id: string;
  name: string;
  examples: string;
  /** AI活用で削減できる工数の割合(保守的な目安) */
  automationRate: number;
  difficulty: Difficulty;
  /** この準備度の回答が1以下だと難易度が1段上がる */
  prerequisite?: ReadinessId;
  approach: string;
  tools: string[];
  firstStep: string;
};

export const TASKS = [
  {
    id: "inquiry",
    name: "問い合わせ・メール対応",
    examples: "顧客からの問い合わせへの返信、定型メールの作成",
    automationRate: 0.4,
    difficulty: 1,
    approach:
      "過去の返信例とFAQをもとに、AIが返信文の下書きを作成し、担当者は確認・修正だけを行う。",
    tools: ["生成AIチャット(法人プラン)", "メールソフトのAIアシスタント"],
    firstStep:
      "よくある問い合わせを10件選び、返信テンプレートとAI用の指示文を作る。",
  },
  {
    id: "documents",
    name: "見積書・提案書の作成",
    examples: "見積書、提案書、企画書、仕様書のたたき台作成",
    automationRate: 0.35,
    difficulty: 2,
    prerequisite: "dataLocation",
    approach:
      "過去の提案書・見積の実績をもとに、ヒアリング内容から構成案と文章のたたき台をAIで作成する。",
    tools: ["生成AIチャット(法人プラン)", "スライド作成AI"],
    firstStep:
      "受注実績のある提案書を5〜10件集め、共通の構成をテンプレート化する。",
  },
  {
    id: "minutes",
    name: "議事録・報告書の作成",
    examples: "会議の議事録、商談メモ、日報・週報",
    automationRate: 0.6,
    difficulty: 1,
    approach:
      "会議を録音・文字起こしし、AIが要点・決定事項・ToDoを自動でまとめる。",
    tools: ["AI議事録ツール", "Web会議ツールの要約機能"],
    firstStep: "定例会議1つで録音と自動要約を試し、修正にかかる時間を計測する。",
  },
  {
    id: "dataEntry",
    name: "データ入力・転記",
    examples: "紙・PDF・FAXの内容をExcelやシステムに入力",
    automationRate: 0.5,
    difficulty: 2,
    prerequisite: "dataLocation",
    approach:
      "AI-OCRで書類を読み取り、必要な項目を抽出して自動入力する。人は差分の確認だけを行う。",
    tools: ["AI-OCR", "RPA・ノーコード連携ツール"],
    firstStep: "件数が最も多い書類を1種類選び、項目定義と読み取り精度を検証する。",
  },
  {
    id: "accounting",
    name: "請求・経費・経理処理",
    examples: "請求書の発行・照合、経費精算、仕訳入力",
    automationRate: 0.3,
    difficulty: 2,
    prerequisite: "dataLocation",
    approach:
      "クラウド会計・経費精算のAI機能で、領収書の読み取りや仕訳の候補作成を自動化する。",
    tools: ["クラウド会計ソフト", "経費精算システム"],
    firstStep: "現在の経理フローを書き出し、手入力している箇所を特定する。",
  },
  {
    id: "internalHelpdesk",
    name: "社内問い合わせ対応",
    examples: "総務・人事・ITへの「これどうするの?」への回答",
    automationRate: 0.45,
    difficulty: 2,
    prerequisite: "manuals",
    approach:
      "社内規程やマニュアルをAIに読み込ませ、社員が自分で答えを調べられる社内AIアシスタントを作る。",
    tools: ["社内文書検索AI(RAG)", "チャットツール連携ボット"],
    firstStep: "過去1ヶ月の社内問い合わせを集計し、上位20件の回答を文書化する。",
  },
  {
    id: "search",
    name: "社内資料・情報の検索",
    examples: "過去の資料、図面、仕様、取引履歴を探す時間",
    automationRate: 0.5,
    difficulty: 2,
    prerequisite: "dataLocation",
    approach:
      "散らばった資料を1か所に集め、自然な文章で質問すると該当資料と要点を返す検索AIを導入する。",
    tools: ["社内文書検索AI(RAG)", "クラウドストレージのAI検索"],
    firstStep: "よく探される資料の保存場所を洗い出し、フォルダ構成を整理する。",
  },
  {
    id: "reporting",
    name: "集計・分析・レポート作成",
    examples: "売上・KPIの集計、月次レポート、会議資料の数値更新",
    automationRate: 0.45,
    difficulty: 2,
    prerequisite: "dataLocation",
    approach:
      "データの集計を自動化し、数値の変化とその要因の説明文をAIが作成する。",
    tools: ["BIツール", "表計算ソフトのAI機能"],
    firstStep: "毎月作っているレポートを1つ選び、元データと集計手順を書き出す。",
  },
  {
    id: "salesResearch",
    name: "営業リスト作成・リサーチ",
    examples: "見込み客リストの作成、企業・業界の下調べ",
    automationRate: 0.5,
    difficulty: 1,
    approach:
      "Web検索機能付きのAIで企業情報を調べ、ターゲット条件に合うリストと商談前の要点メモを作る。",
    tools: ["Web検索付き生成AI", "CRM・営業支援ツール"],
    firstStep: "理想の顧客像の条件を言語化し、AIに10社分のリサーチをさせて精度を見る。",
  },
  {
    id: "manual",
    name: "マニュアル・手順書の作成",
    examples: "業務マニュアル、作業手順書、教育資料",
    automationRate: 0.5,
    difficulty: 1,
    approach:
      "作業の説明を話した音声や画面録画から、AIが手順書の下書きを作成する。",
    tools: ["生成AIチャット(法人プラン)", "画面録画からの手順書作成ツール"],
    firstStep: "新人が最初に覚える業務を1つ選び、手順書を試作する。",
  },
] as const satisfies readonly TaskMaster[];

export type TaskId = (typeof TASKS)[number]["id"];

export const TASK_IDS = TASKS.map((t) => t.id) as [TaskId, ...TaskId[]];

export const DEFAULT_HOURLY_COST = 3_000;

// 上位何件を施策として提案するか
export const TOP_RECOMMENDATIONS = 5;
