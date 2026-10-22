import { formatNumber } from "../format";
import type { Direction, KpiSet, Stat } from "./kpi";
import { MIN_RELIABLE_N } from "./kpi";

// KPIの定義・計算式・データ源。画面・報告書・CSV/Markdownの書き出し・ドキュメントに同じ文言を出すため、ここに一元化する。
// 区分と定義は docs/manufacturing/use-cases.md 5.8、ベースラインの測り方は sales/poc-plan.md 5章に対応する。

export type KpiId =
  | "leadTime"
  | "workMinutes"
  | "nonEstimator"
  | "adoption"
  | "deficit"
  | "winRate"
  | "aiCost"
  | "rework";

export type ValueKind = "days" | "minutes" | "percent" | "yen" | "count";

export type KpiDef = {
  id: KpiId;
  /** 区分(use-cases.md 5.8) */
  category: string;
  name: string;
  kind: ValueKind;
  /** 良い方向。none は良し悪しを決めない(導入前の値がない指標など) */
  direction: Direction;
  stat: (k: KpiSet) => Stat;
  definition: string;
  formula: string;
  baselineSource: string;
  postSource: string;
  /** 読み方の注意 */
  caution: string;
};

export const KPI_DEFS: readonly KpiDef[] = [
  {
    id: "leadTime",
    category: "速さ",
    name: "見積回答リードタイム",
    kind: "days",
    direction: "lower",
    stat: (k) => k.leadTimeDays,
    definition: "引き合いの受付日から回答日までの営業日数の中央値。土日を除いて数え、祝日・会社の休業日は除いていません。",
    formula: "中央値( 営業日数(受付日 → 回答日) )。回答日のない記録は除く。",
    baselineSource: "記録シートの「受付日時」「回答日時」",
    postSource: "見積アシストの引き合い登録日と承認日(回答の送信は人が行うため、承認日を回答日とみなす)",
    caution: "同じ日に受付・回答なら0営業日。期間の末尾は、まだ回答していない案件が多く、件数が少なく出ます。",
  },
  {
    id: "workMinutes",
    category: "工数",
    name: "見積1件あたりの作業時間",
    kind: "minutes",
    direction: "lower",
    stat: (k) => k.workMinutes,
    definition: "1件の見積のために手を動かした時間(分)の平均。待ち時間は含めない前提です。",
    formula: "平均( 作業時間 )。導入前は 作業時間:営業・事務 + 作業時間:見積担当(どちらかが空欄なら、空欄は0分)。作業時間のない記録は除く。",
    baselineSource: "記録シートの「作業時間:営業・事務(分)」と「作業時間:見積担当(分)」の合計",
    postSource: "見積アシストの登録から承認までの経過時間(分)。待ち時間を含む上限値で、手を動かした時間の実測ではない",
    caution:
      "導入前は手を動かした時間の自己記録、導入後は経過時間なので、そろっていません。導入後のほうが長めに出るため、短縮は控えめに出ます。PoCでは時刻のメモで実測した値で補ってください。",
  },
  {
    id: "nonEstimator",
    category: "属人化",
    name: "見積担当者以外が作成した割合",
    kind: "percent",
    direction: "higher",
    stat: (k) => k.nonEstimatorShare,
    definition: "見積を作成した人のうち、見積担当者の名簿にいない人(営業・事務・若手など)の割合。高いほど、特定の人に集中していません。",
    formula: "見積担当者以外が作成した件数 ÷ 作成者が分かる件数。作成者が空欄の記録は除く。担当者の名簿は部分一致で照合する。",
    baselineSource: "記録シートの「見積担当」と、ベースライン画面の見積担当者の名簿",
    postSource: "見積アシストの引き合い登録時に選んだ「見積を作る人」",
    caution: "名簿の書き方(「白石」と「代表取締役 白石」など)は部分一致で同じ人とみなします。",
  },
  {
    id: "adoption",
    category: "AI品質",
    name: "AI案の採用率・修正率",
    kind: "percent",
    direction: "none",
    stat: (k) => k.adoptionOverall,
    definition:
      "AIが作った案(読み取りの結果、工数案、見積の条件)のうち、人が変えずに採用した項目の割合(採用率)と、人が修正した項目の割合(修正率)。承認した見積だけが対象です。項目別の値は下の表にあります。",
    formula: "採用率 = (評価した項目数 − 修正した項目数) ÷ 評価した項目数。修正率 = 修正した項目数 ÷ 評価した項目数(採用率と足して100%)。工数は工程ごとに数える。",
    baselineSource: "なし(導入前はAIを使っていない)",
    postSource: "見積アシストの修正の記録(抽出項目の手修正、工程・条件のAI案からの変更)",
    caution: "採用率が高いことは「正しい」ことを意味しません。人が確認せずに通した可能性もあるため、自信のある誤りの指標(PoC計画書 4章)とあわせて見ます。",
  },
  {
    id: "deficit",
    category: "精度",
    name: "見積と実績の差(赤字案件の割合)",
    kind: "percent",
    direction: "lower",
    stat: (k) => k.deficitShare,
    definition: "実績原価が入った受注案件のうち、実績原価が受注額(税抜)を超えた案件の割合。あわせて、原価差率 =(実績原価 − 見積原価)÷ 見積原価の中央値を出します。",
    formula: "実績原価 > 受注額の件数 ÷ 実績原価と受注額がある受注件数。見積原価は利益と端数処理を除いた明細の合計。",
    baselineSource: "記録シートの拡張列(受注額・見積原価・実績原価)。生産管理などから入れる",
    postSource: "見積アシストの承認時の明細と、画面で記録した実績原価",
    caution: "製作が終わるまで実績は入りません。直近の期間は実績のない案件が多く、件数が少なく出ます。",
  },
  {
    id: "winRate",
    category: "受注",
    name: "見積受注率",
    kind: "percent",
    direction: "higher",
    stat: (k) => k.winRate,
    definition: "回答した見積のうち、受注になった割合。",
    formula: "受注件数 ÷(受注件数 + 失注件数)。回答済みで結果が未定の記録は除く。",
    baselineSource: "記録シートの「受注/失注」",
    postSource: "画面で記録した受注・失注(正本はSalesforce)",
    caution: "受注は価格・納期・市況などにも左右されます。見積アシストの効果とは断定できません。",
  },
  {
    id: "aiCost",
    category: "費用",
    name: "1件あたりのAI費用(概算)",
    kind: "yen",
    direction: "none",
    stat: (k) => k.aiCostJpy,
    definition: "1件の処理でAIに払う費用の概算の平均(円)。トークン数と料金表から計算します。処理時間・トークン数も記録しています。",
    formula: "平均( 処理ごとの概算費用 )。AIを使った記録だけが対象。デモモード(AI未使用)の記録は含めない。",
    baselineSource: "なし(導入前はAIを使っていない)",
    postSource: "見積アシストの処理ごとの記録(トークン数・概算費用)",
    caution: "為替・料金の改定で変わります。月額費用ではなく、API利用量の概算です。",
  },
  {
    id: "rework",
    category: "手戻り",
    name: "受注後の手戻り",
    kind: "count",
    direction: "lower",
    stat: (k) => k.reworkPerWon,
    definition: "受注後に発生した仕様の確認・手戻りの件数を、受注1件あたりで表した値。",
    formula: "手戻り件数の合計 ÷ 手戻り件数が記録された受注件数。",
    baselineSource: "記録シートの拡張列(手戻り件数)。営業の記録から入れる",
    postSource: "画面で記録した手戻り件数",
    caution: "受注後に起きるため、直近の期間は記録が少なく出ます。",
  },
];

export function kpiDef(id: KpiId): KpiDef {
  return KPI_DEFS.find((d) => d.id === id)!;
}

export const KIND_UNIT: Record<ValueKind, string> = {
  days: "営業日",
  minutes: "分",
  percent: "%",
  yen: "円",
  count: "件/受注1件",
};

/** 値の表示(単位つき)。null は「—」 */
export function formatKpiValue(kind: ValueKind, value: number | null): string {
  if (value === null) return "—";
  switch (kind) {
    case "days":
      return `${formatNumber(value, 1)}営業日`;
    case "minutes":
      return `${formatNumber(value, 0)}分`;
    case "percent":
      return `${formatNumber(value * 100, 0)}%`;
    case "yen":
      return `${Math.round(value).toLocaleString("ja-JP")}円`;
    case "count":
      return `${formatNumber(value, 2)}件`;
  }
}

/** 差の表示。割合の指標は「ポイント」。符号をつける */
export function formatKpiDiff(kind: ValueKind, diff: number | null): string {
  if (diff === null) return "—";
  const sign = diff > 0 ? "+" : diff < 0 ? "−" : "±";
  const abs = Math.abs(diff);
  switch (kind) {
    case "days":
      return `${sign}${formatNumber(abs, 1)}営業日`;
    case "minutes":
      return `${sign}${formatNumber(abs, 0)}分`;
    case "percent":
      return `${sign}${formatNumber(abs * 100, 0)}ポイント`;
    case "yen":
      return `${sign}${Math.round(abs).toLocaleString("ja-JP")}円`;
    case "count":
      return `${sign}${formatNumber(abs, 2)}件`;
  }
}

/** 変化率(差 ÷ 導入前)。導入前が0などで出せないときは null */
export function formatChangeRate(rate: number | null): string | null {
  if (rate === null) return null;
  const sign = rate > 0 ? "+" : rate < 0 ? "−" : "±";
  return `${sign}${formatNumber(Math.abs(rate) * 100, 0)}%`;
}

export const REFERENCE_NOTE = `件数が${MIN_RELIABLE_N}件に満たない値は「参考値」です(中央値・割合は件数が少ないと、1件で大きく動きます)。`;

export const HONESTY_NOTES: readonly string[] = [
  "ここに出る数字は、試験導入の期間に実測した値です。導入前の期間とは、案件の種類・件数・季節・担当者が同じとは限らず、差のすべてを見積アシストの効果とは断定できません。",
  "導入後の値は、見積アシストの記録から決まった計算式で出しています(AIには数字を作らせていません)。",
  "導入前の値は、御社が記録シートに入れた値です。実測できず推定した行は、メモに「推定」と書くと報告書に件数が出ます。",
  "回答日は、見積アシストでは承認した日です。お客様への送信は人が行うため、実際の送信日とずれることがあります。",
  REFERENCE_NOTE,
];
