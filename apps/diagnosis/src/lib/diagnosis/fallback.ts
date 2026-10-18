import { formatHours, formatYen } from "../format";
import { READINESS_QUESTIONS, TASKS, type ReadinessId } from "./master";
import {
  READINESS_LEVEL_LABEL,
  type DiagnosisResult,
  type TaskResult,
} from "./calculate";
import type { AiReport } from "./schema";

// APIキーがない場合やAIの呼び出しに失敗した場合に使う標準レポート。

const READINESS_ADVICE: Record<ReadinessId, string> = {
  dataLocation:
    "紙や個人PCにある業務データを、共有フォルダやクラウドに集めることから始めましょう。AIが参照できるデータが増えるほど効果が上がります。",
  manuals:
    "よく発生する業務から手順を文書化しましょう。AIに業務を任せるときの指示書にもなります。",
  aiUsage:
    "まずは法人向けの生成AIを数名で試し、どの業務で効果が出るかを確かめましょう。",
  itStaff:
    "AI活用の推進役を1名決めましょう。兼任でも、相談先と予算を明確にすることが大切です。",
  rules:
    "入力してよい情報・いけない情報を決めた簡単な利用ルールを作りましょう。個人の判断で使う状態はリスクになります。",
  leadership:
    "経営として「何のためにAIを使うか」を決め、担当者と期限を設定しましょう。",
};

export function fallbackRecommendation(
  task: TaskResult,
): AiReport["recommendations"][number] {
  const master = TASKS.find((m) => m.id === task.taskId)!;
  const prerequisite =
    "prerequisite" in master
      ? READINESS_QUESTIONS.find((q) => q.id === master.prerequisite)
      : undefined;
  return {
    taskId: task.taskId,
    title: `${task.name}のAI活用`,
    approach: master.approach,
    tools: [...master.tools],
    firstStep: master.firstStep,
    caution:
      task.prerequisiteGap && prerequisite
        ? `「${prerequisite.label}」が整っていないと効果が出にくいため、並行して整備しましょう。`
        : "いきなり全社に広げず、1つの部署や業務で効果を測ってから展開しましょう。",
  };
}

export function buildFallbackReport(result: DiagnosisResult): AiReport {
  const { readiness, totals, top } = result;
  const weakItems = readiness.breakdown.filter((b) => b.points <= 1);

  // 画面の数値と表記をそろえる(例:1400.5時間 → 1,401時間)
  const summary = [
    `入力いただいた業務の月間合計${formatHours(totals.monthlyHours)}のうち、AI活用によって年間約${formatHours(totals.annualSavedHours)}(約${formatYen(totals.annualSavedAmount)})の削減が見込めます。`,
    `特に効果が大きいのは「${top[0]?.name ?? "-"}」です。`,
    `AI導入の準備度は${readiness.score}点(${READINESS_LEVEL_LABEL[readiness.level]})です。`,
    readiness.level === "preparation"
      ? "ツールを入れる前に、データの置き場所やルールといった土台を整えることで、効果を大きく引き上げられます。"
      : "小さく始めて効果を測り、成果が出た業務から広げていく進め方がおすすめです。",
  ].join("");

  return {
    summary,
    recommendations: top.map(fallbackRecommendation),
    roadmap: [
      {
        period: "1ヶ月目",
        goal:
          weakItems.length > 0
            ? "AI活用の土台を整え、最初の業務で試す"
            : "最初の業務でAIを試し、効果を測る",
        actions: [
          ...(weakItems.length > 0
            ? [`${weakItems[0].label}を整える`]
            : []),
          "推進担当者とAI利用ルールを決める",
          `「${top[0]?.name ?? "優先業務"}」で試験導入する`,
        ],
      },
      {
        period: "2ヶ月目",
        goal: "効果を数字で確認し、対象業務を広げる",
        actions: [
          "試験導入した業務の作業時間を導入前と比べる",
          top[1] ? `「${top[1].name}」に展開する` : "対象部署を広げる",
          "使い方のコツを社内で共有する",
        ],
      },
      {
        period: "3ヶ月目",
        goal: "全社展開の計画を立てる",
        actions: [
          "効果の出た業務の手順を標準化する",
          "残りの優先業務の導入計画と予算を決める",
        ],
      },
    ],
    readinessAdvice:
      weakItems.length > 0
        ? weakItems.slice(0, 4).map((b) => READINESS_ADVICE[b.id])
        : ["準備は整っています。効果測定の仕組みを先に決めておくと、展開の判断がしやすくなります。"],
    discussionPoints: [
      "優先業務の現状フローと、AIに任せる範囲の線引き",
      "ツール選定と、既存システムとの連携方法",
      "効果測定の指標(KPI)と、導入後の運用体制",
    ],
  };
}
