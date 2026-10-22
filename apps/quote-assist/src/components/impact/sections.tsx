import Link from "next/link";
import type { ReactNode } from "react";
import { Notice } from "@/components/ui";
import { adoptionItemGroup, adoptionItemLabel, ADOPTION_GROUP_LABEL } from "@/lib/domain/impact";
import { formatKpiValue, HONESTY_NOTES, KPI_DEFS, type KpiDef, type ValueKind } from "@/lib/impact/definitions";
import { isReference, type KpiSet, type Stat } from "@/lib/impact/kpi";
import type { ImpactView } from "@/lib/impact/load";
import { diffText, periodText, statText, supplementary, VERDICT_TEXT, type ImpactReport, type ReportRow } from "@/lib/impact/report";
import { AdoptionBars, TrendChart, type TrendPoint } from "./charts";

// 効果測定ダッシュボードと報告書に共通の表示部品(サーバーコンポーネント)

export function ReferenceBadge() {
  return <span className="ml-1.5 inline-block rounded border border-line-strong px-1.5 py-px align-middle text-xs font-medium text-ink-2">参考値</span>;
}

export function SegmentedLinks({ label, options }: { label: string; options: { href: string; text: string; current: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-ink-2">{label}</span>
      <div role="group" aria-label={label} className="inline-flex overflow-hidden rounded-md border border-line-strong">
        {options.map((o) => (
          <Link
            key={o.text}
            href={o.href}
            replace
            aria-current={o.current ? "true" : undefined}
            className={`px-3 py-1.5 ${o.current ? "bg-accent-strong font-semibold text-white" : "bg-surface text-ink-2 hover:bg-surface-2"}`}
          >
            {o.text}
          </Link>
        ))}
      </div>
    </div>
  );
}

/** 集計の対象(導入前・導入後のデータの出どころ、期間、件数) */
export function ContextBanner({ view }: { view: ImpactView }) {
  const { report } = view;
  return (
    <div className="space-y-1 rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm text-ink-2" data-testid="impact-context">
      <p>
        <span className="font-semibold text-ink">導入前(ベースライン)</span>:{report.baseline.label}
        {view.baselineOrigin !== "none" && `・受付 ${periodText(report.baseline.period)}・${report.baseline.kpis.cases}件`}
        {report.baseline.estimatedRows > 0 && `(うち推定を含む行 ${report.baseline.estimatedRows}件)`}
      </p>
      <p>
        <span className="font-semibold text-ink">導入後(試験導入)</span>:{report.post.label}・受付 {periodText(report.post.period)}・{report.post.kpis.cases}件
      </p>
      {view.baselineNote && <p className="text-xs text-muted">{view.baselineNote}</p>}
      {view.postNote && <p className="text-xs text-muted">{view.postNote}</p>}
    </div>
  );
}

const ARROW = { better: "✓", worse: "!", same: "＝", unknown: "" } as const;

function VerdictLabel({ row }: { row: ReportRow }) {
  const c = row.comparison;
  if (row.def.direction === "none" || c.verdict === "unknown") return null;
  if (c.reference) return <span className="text-xs text-muted">参考値のため、良し悪しは判断しません</span>;
  const cls = c.verdict === "better" ? "text-good" : c.verdict === "worse" ? "text-critical-ink" : "text-ink-2";
  return (
    <span className={`text-xs font-semibold ${cls}`}>
      <span aria-hidden="true">{ARROW[c.verdict]} </span>
      {VERDICT_TEXT[c.verdict]}
    </span>
  );
}

function tileNote(row: ReportRow, kpis: KpiSet): string | null {
  if (row.def.id === "adoption") {
    return row.post.value === null ? null : `修正率 ${Math.round((1 - row.post.value) * 100)}%・評価した記録 ${row.post.n}件`;
  }
  if (row.def.id === "aiCost") {
    const ms = kpis.aiProcessingMs.value;
    return ms === null ? null : `処理時間の平均 ${(ms / 1000).toFixed(1)}秒`;
  }
  return null;
}

export function KpiTile({ row, kpis }: { row: ReportRow; kpis: KpiSet }) {
  const { def, baseline, post, comparison: c } = row;
  const hasBaseline = baseline.value !== null;
  const note = tileNote(row, kpis);
  return (
    <div className="rounded-xl border border-line bg-surface p-4" data-testid={`kpi-${def.id}`}>
      <p className="text-sm text-ink-2">{def.name}</p>
      <p className="mt-1 text-3xl font-bold">
        {post.value === null ? "—" : formatKpiValue(def.kind, post.value)}
        {isReference(post) && <ReferenceBadge />}
      </p>
      <p className="mt-1 text-xs text-muted">
        {post.value === null ? "導入後:対象なし" : `導入後:${post.n}件で計算`}
        {post.missing > 0 && `(欠損${post.missing}件を除く)`}
      </p>
      <div className="mt-2 space-y-0.5 border-t border-line pt-2 text-xs">
        {def.direction !== "none" ? (
          post.value === null ? (
            <p className="text-ink-2">導入後の値がないため、比較できません</p>
          ) : hasBaseline ? (
            <>
              <p className="text-ink-2">
                導入前 {statText(def, baseline)}・差 {diffText(def, c)}
              </p>
              <p>
                <VerdictLabel row={row} />
              </p>
            </>
          ) : (
            <p className="text-ink-2">導入前の値がありません</p>
          )
        ) : (
          <p className="text-ink-2">{note ?? "導入前との比較はありません(導入前はAIを使っていません)"}</p>
        )}
        {def.direction !== "none" && note && <p className="text-ink-2">{note}</p>}
      </div>
    </div>
  );
}

export function KpiTiles({ report }: { report: ImpactReport }) {
  return (
    <section aria-label="主な指標" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {report.rows.map((row) => (
        <KpiTile key={row.def.id} row={row} kpis={report.post.kpis} />
      ))}
    </section>
  );
}

export function ComparisonTable({ report }: { report: ImpactReport }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm" aria-label="導入前後の比較">
        <thead className="text-left text-ink-2">
          <tr className="border-b border-line">
            <th className="py-2 pr-3 font-medium">区分</th>
            <th className="py-2 pr-3 font-medium">指標</th>
            <th className="py-2 pr-3 text-right font-medium">導入前</th>
            <th className="py-2 pr-3 text-right font-medium">導入後</th>
            <th className="py-2 pr-3 text-right font-medium">差(導入後−導入前)</th>
            <th className="py-2 text-right font-medium">件数(前/後)</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((r) => (
            <tr key={r.def.id} className="border-b border-line align-top last:border-0" data-testid={`row-${r.def.id}`}>
              <td className="py-2 pr-3 text-ink-2">{r.def.category}</td>
              <th scope="row" className="py-2 pr-3 text-left font-medium">
                {r.def.name}
              </th>
              <td className="py-2 pr-3 text-right tabular-nums">{statText(r.def, r.baseline)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{statText(r.def, r.post)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {r.def.direction === "none" ? "—" : diffText(r.def, r.comparison)}
                <div className="text-right">
                  <VerdictLabel row={r} />
                </div>
              </td>
              <td className="py-2 text-right tabular-nums">
                {r.baseline.n} / {r.post.n}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SupplementaryTable({ report }: { report: ImpactReport }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm" aria-label="補助の値">
        <thead className="text-left text-ink-2">
          <tr className="border-b border-line">
            <th className="py-2 pr-3 font-medium">項目</th>
            <th className="py-2 pr-3 text-right font-medium">導入前</th>
            <th className="py-2 text-right font-medium">導入後</th>
          </tr>
        </thead>
        <tbody>
          {supplementary(report).map((s) => (
            <tr key={s.label} className="border-b border-line last:border-0">
              <th scope="row" className="py-2 pr-3 text-left font-normal">
                {s.label}
              </th>
              <td className="py-2 pr-3 text-right tabular-nums">{s.baseline}</td>
              <td className="py-2 text-right tabular-nums">{s.post}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type TrendSpec = {
  id: string;
  title: string;
  kind: ValueKind;
  pick: (k: KpiSet) => Stat;
  baseline: boolean;
};

const TRENDS: TrendSpec[] = [
  { id: "leadTime", title: "見積回答リードタイム(中央値)", kind: "days", pick: (k) => k.leadTimeDays, baseline: true },
  { id: "workMinutes", title: "見積1件あたりの作業時間(平均)", kind: "minutes", pick: (k) => k.workMinutes, baseline: true },
  { id: "nonEstimator", title: "見積担当者以外が作成した割合", kind: "percent", pick: (k) => k.nonEstimatorShare, baseline: true },
  { id: "winRate", title: "見積受注率", kind: "percent", pick: (k) => k.winRate, baseline: true },
  { id: "adoption", title: "AI案の採用率(全項目)", kind: "percent", pick: (k) => k.adoptionOverall, baseline: false },
  { id: "aiCost", title: "1件あたりのAI費用(概算)", kind: "yen", pick: (k) => k.aiCostJpy, baseline: false },
];

export function TrendGrid({ report }: { report: ImpactReport }) {
  if (report.series.length === 0) return <p className="text-sm text-muted">導入後の記録がまだありません。</p>;
  const unit = report.granularity === "week" ? "週ごと" : "月ごと";
  const baseKpis = report.baseline.kpis;
  return (
    <div className="grid gap-x-8 gap-y-8 lg:grid-cols-2 print:grid-cols-2 print:gap-x-4" data-testid="trend-grid">
      {TRENDS.map((t) => {
        const points: TrendPoint[] = report.series.map((p) => {
          const s = t.pick(p.kpis);
          return { key: p.key, label: p.label, longLabel: p.longLabel, value: s.value, n: s.n, reference: isReference(s) };
        });
        const b = t.pick(baseKpis);
        return (
          <TrendChart
            key={t.id}
            testId={`trend-${t.id}`}
            title={t.title}
            subtitle={`導入後・${unit}(受付日で集計)`}
            kind={t.kind}
            points={points}
            baseline={t.baseline && b.value !== null ? { value: b.value, n: b.n } : null}
          />
        );
      })}
    </div>
  );
}

export function AdoptionSection({ report }: { report: ImpactReport }) {
  const rows = report.post.kpis.adoption.map((a) => ({
    item: a.item,
    label: adoptionItemLabel(a.item),
    group: adoptionItemGroup(a.item),
    evaluated: a.evaluated,
    modified: a.modified,
    adoptedRate: a.adoptedRate,
  }));
  if (rows.length === 0) {
    return <p className="text-sm text-muted">承認した見積の記録がまだありません。承認すると、AI案をどれだけ修正したかが集計されます。</p>;
  }
  return <AdoptionBars rows={rows} groupLabels={ADOPTION_GROUP_LABEL} />;
}

export function DefinitionsSection({ defs = KPI_DEFS }: { defs?: readonly KpiDef[] }) {
  return (
    <dl className="grid gap-4 lg:grid-cols-2" data-testid="definitions">
      {defs.map((d) => (
        <div key={d.id} className="space-y-1.5 break-inside-avoid rounded-lg border border-line p-4 text-sm">
          <dt className="font-semibold">
            {d.name}
            <span className="ml-2 text-xs font-normal text-muted">{d.category}</span>
          </dt>
          <dd className="space-y-1 text-ink-2">
            <p>{d.definition}</p>
            <p>
              <span className="font-medium text-ink">計算式:</span>
              {d.formula}
            </p>
            <p>
              <span className="font-medium text-ink">導入前のデータ:</span>
              {d.baselineSource}
            </p>
            <p>
              <span className="font-medium text-ink">導入後のデータ:</span>
              {d.postSource}
            </p>
            <p>
              <span className="font-medium text-ink">読み方:</span>
              {d.caution}
            </p>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function HonestyNotes() {
  return (
    <Notice level="info">
      <ul className="list-disc space-y-1 pl-5">
        {HONESTY_NOTES.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </Notice>
  );
}

export function SectionTitle({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="space-y-1">
      <h2 className="text-lg font-bold">{children}</h2>
      {note && <p className="text-sm text-muted">{note}</p>}
    </div>
  );
}
