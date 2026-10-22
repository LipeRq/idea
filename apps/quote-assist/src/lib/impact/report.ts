import { formatDate } from "../format";
import { adoptionItemGroup, adoptionItemLabel, ADOPTION_GROUP_LABEL, type CaseRecord } from "../domain/impact";
import { toCsv } from "./baseline-csv";
import {
  formatChangeRate,
  formatKpiDiff,
  formatKpiValue,
  HONESTY_NOTES,
  KIND_UNIT,
  KPI_DEFS,
  type KpiDef,
} from "./definitions";
import {
  compareStat,
  computeKpis,
  isReference,
  MIN_RELIABLE_N,
  periodSeries,
  type Comparison,
  type Granularity,
  type KpiSet,
  type PeriodPoint,
  type Stat,
} from "./kpi";

// 画面・印刷用の報告書・CSV・Markdown が共有する「導入前後の比較」の組み立て。

export type ReportRow = { def: KpiDef; baseline: Stat; post: Stat; comparison: Comparison };

export type ReportSide = {
  label: string;
  kpis: KpiSet;
  period: { from: string; to: string } | null;
};

export type ImpactReport = {
  generatedOn: string;
  granularity: Granularity;
  estimators: string[];
  baseline: ReportSide & { estimatedRows: number };
  post: ReportSide;
  rows: ReportRow[];
  series: PeriodPoint[];
};

function periodOf(records: readonly CaseRecord[]): ReportSide["period"] {
  if (records.length === 0) return null;
  const dates = records.map((r) => r.receivedAt).sort();
  return { from: dates[0], to: dates[dates.length - 1] };
}

export function buildImpactReport(input: {
  generatedOn: string;
  granularity: Granularity;
  estimators: readonly string[];
  baselineLabel: string;
  baselineRecords: readonly CaseRecord[];
  baselineEstimatedRows: number;
  postLabel: string;
  postRecords: readonly CaseRecord[];
}): ImpactReport {
  const base = computeKpis(input.baselineRecords, input.estimators);
  const post = computeKpis(input.postRecords, input.estimators);
  return {
    generatedOn: input.generatedOn,
    granularity: input.granularity,
    estimators: [...input.estimators],
    baseline: {
      label: input.baselineLabel,
      kpis: base,
      period: periodOf(input.baselineRecords),
      estimatedRows: input.baselineEstimatedRows,
    },
    post: { label: input.postLabel, kpis: post, period: periodOf(input.postRecords) },
    rows: KPI_DEFS.map((def) => ({
      def,
      baseline: def.stat(base),
      post: def.stat(post),
      comparison: compareStat(def.stat(base), def.stat(post), def.direction),
    })),
    series: periodSeries(input.postRecords, input.granularity, input.estimators),
  };
}

export function periodText(p: ReportSide["period"]): string {
  if (!p) return "記録なし";
  return p.from === p.to ? formatDate(p.from) : `${formatDate(p.from)}〜${formatDate(p.to)}`;
}

/** 値の表示。分母が0なら「対象なし」、件数が少なければ「(参考値)」 */
export function statText(def: Pick<KpiDef, "kind">, s: Stat): string {
  if (s.value === null) return "対象なし";
  return `${formatKpiValue(def.kind, s.value)}${isReference(s) ? "(参考値)" : ""}`;
}

export function diffText(def: Pick<KpiDef, "kind">, c: Comparison): string {
  if (c.diff === null) return "—";
  const rate = formatChangeRate(c.rate);
  return `${formatKpiDiff(def.kind, c.diff)}${rate && def.kind !== "percent" ? `(${rate})` : ""}`;
}

export const VERDICT_TEXT = { better: "導入前より良い方向", worse: "導入前より悪い方向", same: "変化なし", unknown: "" } as const;

/** 補助の値(中央値・原価差率・AIの処理量) */
export function supplementary(report: ImpactReport): { label: string; baseline: string; post: string }[] {
  const b = report.baseline.kpis;
  const p = report.post.kpis;
  const num = (v: number | null, kind: KpiDef["kind"]) => (v === null ? "—" : formatKpiValue(kind, v));
  return [
    { label: "作業時間の中央値", baseline: num(b.workMinutesMedian, "minutes"), post: num(p.workMinutesMedian, "minutes") },
    {
      label: "原価差率の中央値((実績−見積)÷見積)",
      baseline: b.costGapRate.value === null ? "—" : `${(b.costGapRate.value * 100).toFixed(1)}%(${b.costGapRate.n}件)`,
      post: p.costGapRate.value === null ? "—" : `${(p.costGapRate.value * 100).toFixed(1)}%(${p.costGapRate.n}件)`,
    },
    {
      label: "工数の修正幅の中央値(修正した工程)",
      baseline: "—",
      post: p.hourChange.value === null ? "—" : `${(p.hourChange.value * 100).toFixed(0)}%(${p.hourChange.n}工程)`,
    },
    {
      label: "AIの処理時間の平均",
      baseline: "—",
      post: p.aiProcessingMs.value === null ? "—" : `${(p.aiProcessingMs.value / 1000).toFixed(1)}秒`,
    },
    {
      label: "AIのトークン数の平均(入力+出力)",
      baseline: "—",
      post: p.aiTokens.value === null ? "—" : `${Math.round(p.aiTokens.value).toLocaleString("ja-JP")}`,
    },
  ];
}

// ---- CSV ----

export function summaryCsv(report: ImpactReport): string {
  return toCsv([
    ["区分", "KPI", "単位", "導入前", "導入前の件数", "導入前の欠損", "導入後", "導入後の件数", "導入後の欠損", "差(導入後−導入前)", "参考値", "定義", "計算式"],
    ...report.rows.map((r) => [
      r.def.category,
      r.def.name,
      KIND_UNIT[r.def.kind],
      r.baseline.value === null ? "" : round(r.baseline.value, r.def.kind),
      r.baseline.n,
      r.baseline.missing,
      r.post.value === null ? "" : round(r.post.value, r.def.kind),
      r.post.n,
      r.post.missing,
      r.comparison.diff === null ? "" : round(r.comparison.diff, r.def.kind),
      r.comparison.reference ? "参考値" : "",
      r.def.definition,
      r.def.formula,
    ]),
  ]);
}

/** 割合は%の数値で出す(0.4 → 40)。単位の列に%とある */
function round(value: number, kind: KpiDef["kind"]): number {
  const v = kind === "percent" ? value * 100 : value;
  return Math.round(v * 100) / 100;
}

export function trendCsv(report: ImpactReport): string {
  const g = report.granularity === "week" ? "週" : "月";
  return toCsv([
    [g, "受付件数", "リードタイム中央値(営業日)", "リードタイムの件数", "作業時間の平均(分)", "作業時間の件数", "見積担当者以外の割合(%)", "受注率(%)", "受注率の件数", "AI案の採用率(%)", "1件あたりAI費用(円)", "参考値(リードタイム)"],
    ...report.series.map((p) => {
      const k = p.kpis;
      const pct = (s: Stat) => (s.value === null ? "" : Math.round(s.value * 1000) / 10);
      const num = (s: Stat, d = 1) => (s.value === null ? "" : Math.round(s.value * 10 ** d) / 10 ** d);
      return [
        p.longLabel,
        k.cases,
        num(k.leadTimeDays),
        k.leadTimeDays.n,
        num(k.workMinutes),
        k.workMinutes.n,
        pct(k.nonEstimatorShare),
        pct(k.winRate),
        k.winRate.n,
        pct(k.adoptionOverall),
        num(k.aiCostJpy, 0),
        isReference(k.leadTimeDays) ? "参考値" : "",
      ];
    }),
  ]);
}

export function adoptionCsv(report: ImpactReport): string {
  return toCsv([
    ["グループ", "項目", "評価した数", "修正した数", "採用率(%)", "修正率(%)"],
    ...report.post.kpis.adoption.map((a) => [
      ADOPTION_GROUP_LABEL[adoptionItemGroup(a.item)],
      adoptionItemLabel(a.item),
      a.evaluated,
      a.modified,
      a.adoptedRate === null ? "" : Math.round(a.adoptedRate * 1000) / 10,
      a.modifiedRate === null ? "" : Math.round(a.modifiedRate * 1000) / 10,
    ]),
  ]);
}

// ---- Markdown ----

const md = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

export function reportMarkdown(report: ImpactReport): string {
  const out: string[] = [];
  const g = report.granularity === "week" ? "週" : "月";
  out.push("# 見積アシスト 効果測定レポート(試験導入期間の実測値)", "");
  out.push(`- 作成日: ${formatDate(report.generatedOn)}`);
  out.push(`- 導入前(ベースライン): ${md(report.baseline.label)} / 受付 ${periodText(report.baseline.period)} / ${report.baseline.kpis.cases}件`);
  if (report.baseline.estimatedRows > 0) out.push(`  - うち推定を含む行: ${report.baseline.estimatedRows}件`);
  out.push(`- 導入後(試験導入): ${md(report.post.label)} / 受付 ${periodText(report.post.period)} / ${report.post.kpis.cases}件`);
  out.push(`- 見積担当者の名簿: ${report.estimators.length > 0 ? report.estimators.map(md).join("、") : "(未設定)"}`);
  out.push("", "> 試験導入の期間に実測した値です。導入前後で案件の種類・件数・担当者が同じとは限らないため、差のすべてを見積アシストの効果とは断定しません。", "");

  out.push("## 1. 導入前後の比較", "");
  out.push("| 区分 | KPI | 導入前 | 導入後 | 差 | 件数(前/後) |", "|---|---|---|---|---|---|");
  for (const r of report.rows) {
    const verdict = VERDICT_TEXT[r.comparison.verdict];
    out.push(
      `| ${r.def.category} | ${md(r.def.name)} | ${statText(r.def, r.baseline)} | ${statText(r.def, r.post)} | ${diffText(r.def, r.comparison)}${verdict && !r.comparison.reference ? `(${verdict})` : ""} | ${r.baseline.n} / ${r.post.n} |`,
    );
  }
  out.push("", "補助の値", "", "| 項目 | 導入前 | 導入後 |", "|---|---|---|");
  for (const s of supplementary(report)) out.push(`| ${s.label} | ${s.baseline} | ${s.post} |`);

  out.push("", "## 2. AI案の採用率・修正率(項目別)", "");
  if (report.post.kpis.adoption.length === 0) out.push("承認した見積の記録がまだありません。");
  else {
    out.push("| 項目 | 評価した数 | 修正した数 | 採用率 | 修正率 |", "|---|---|---|---|---|");
    for (const a of report.post.kpis.adoption) {
      out.push(
        `| ${md(adoptionItemLabel(a.item))} | ${a.evaluated} | ${a.modified} | ${a.adoptedRate === null ? "—" : `${(a.adoptedRate * 100).toFixed(0)}%`} | ${a.modifiedRate === null ? "—" : `${(a.modifiedRate * 100).toFixed(0)}%`} |`,
      );
    }
  }

  out.push("", `## 3. 推移(導入後・${g}ごと、受付日で集計)`, "");
  if (report.series.length === 0) out.push("記録がありません。");
  else {
    out.push(`| ${g} | 受付 | リードタイム中央値 | 作業時間の平均 | 見積担当者以外 | 受注率 | AI案の採用率 |`, "|---|---|---|---|---|---|---|");
    for (const p of report.series) {
      const k = p.kpis;
      const cell = (def: Pick<KpiDef, "kind">, s: Stat) => (s.value === null ? "—" : statText(def, s));
      out.push(
        `| ${md(p.longLabel)} | ${k.cases}件 | ${cell({ kind: "days" }, k.leadTimeDays)} | ${cell({ kind: "minutes" }, k.workMinutes)} | ${cell({ kind: "percent" }, k.nonEstimatorShare)} | ${cell({ kind: "percent" }, k.winRate)} | ${cell({ kind: "percent" }, k.adoptionOverall)} |`,
      );
    }
    out.push("", `(参考値)は、その値に使えた件数が${MIN_RELIABLE_N}件未満です。`);
  }

  out.push("", "## 4. 指標の定義と計算式", "");
  for (const r of report.rows) {
    out.push(`### ${md(r.def.name)}`, "");
    out.push(`- 定義: ${md(r.def.definition)}`);
    out.push(`- 計算式: ${md(r.def.formula)}`);
    out.push(`- 導入前のデータ源: ${md(r.def.baselineSource)}`);
    out.push(`- 導入後のデータ源: ${md(r.def.postSource)}`);
    out.push(`- 読み方の注意: ${md(r.def.caution)}`, "");
  }

  out.push("## 5. 読むときの注意", "");
  for (const n of HONESTY_NOTES) out.push(`- ${n}`);
  out.push("");
  return out.join("\n");
}
