// AI 版のモック(INVENTORY_AI_MODE=mock)。E2E とデモ用に、Claude を呼ばずに決まった文章を返す。
// エンジンの StructuredClient の偽実装で、要約の依頼ではプロンプトの <module name="…"> と「要約するプロシージャ:」の行を読み、
// 全モジュール・全プロシージャに「(デモ用の固定文章)…」を返す。本番で誤って有効にしても分かるよう、文章に明記する。
import type { StructuredClient } from "@engine/doc/ai";
import { ModuleSummariesSchema, type AiOverallRaw, type ModuleSummaries } from "@engine/doc/aiSchema";

export const MOCK_MARK = "(デモ用の固定文章)";

const NO_PROCEDURES = "(なし。宣言部のみ)";

export function mockModuleSummaries(prompt: string): ModuleSummaries {
  const modules: ModuleSummaries["modules"] = [];
  const re = /<module name="([^"]*)"[^>]*>\n要約するプロシージャ: ([^\n]*)/g;
  for (const m of prompt.matchAll(re)) {
    const names = m[2] === NO_PROCEDURES ? [] : m[2].split("、").filter(Boolean);
    modules.push({
      moduleName: m[1],
      purpose: `${MOCK_MARK}このモジュールの業務上の目的の説明がここに入ります。`,
      procedures: names.map((name) => ({ name, summary: `${MOCK_MARK}${name} の処理内容の要約がここに入ります。` })),
      concerns: [],
    });
  }
  return { modules };
}

export const MOCK_OVERALL: AiOverallRaw = {
  overview: `${MOCK_MARK}このファイルが何のための仕組みで、誰がどんな場面で使うかの説明がここに入ります。実際の AI 版では、抽出結果とソースコードをもとに Claude が文章を作成します。`,
  businessFlow: {
    summary: `${MOCK_MARK}業務の流れの説明がここに入ります。`,
    steps: [
      { id: "s1", label: "担当者がデータを入力する", actor: "利用者", next: ["s2"] },
      { id: "s2", label: "マクロが集計・転記する", actor: "マクロ", next: ["s3"] },
      { id: "s3", label: "結果をファイルに出力する", actor: "外部システム", next: [] },
    ],
  },
  risks: [
    {
      title: `${MOCK_MARK}作成者しか中身を知らない`,
      severity: "高",
      detail: "リスクの説明がここに入ります。",
      ruleIds: [],
      recommendation: "対策の説明がここに入ります。",
    },
  ],
  migrations: [
    {
      target: "ノーコード業務アプリ(kintone 等)",
      fit: "中",
      difficulty: "中",
      reason: `${MOCK_MARK}候補に挙げる理由がここに入ります。`,
      approach: "進め方の説明がここに入ります。",
      concerns: "注意点がここに入ります。",
    },
  ],
  recommendation: `${MOCK_MARK}おすすめの進め方がここに入ります。`,
  hearingItems: [`${MOCK_MARK}このマクロを毎日使っているのは誰ですか?`, "止まったときに困る業務は何ですか?", "入力するデータはどこから来ますか?"],
};

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

export function createMockClient(delayMs: number, signal?: AbortSignal): StructuredClient {
  return {
    async generate(req) {
      await sleep(delayMs, signal);
      const result = (req.schema as unknown) === ModuleSummariesSchema ? mockModuleSummaries(req.user) : structuredClone(MOCK_OVERALL);
      return result as never;
    },
  };
}
