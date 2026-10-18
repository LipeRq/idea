"use client";

import { useEffect, useRef } from "react";
import { READINESS_LEVEL_LABEL } from "@/lib/diagnosis/calculate";
import { COST_BY_DIFFICULTY, DIFFICULTY_LABEL } from "@/lib/diagnosis/master";
import type { DiagnosisResponse } from "@/lib/diagnosis/types";
import { formatHours, formatYen } from "@/lib/format";
import { SavingsChart } from "./SavingsChart";

type Props = {
  data: DiagnosisResponse;
  companyName?: string;
  onRestart: () => void;
};

const CONTACT_URL = process.env.NEXT_PUBLIC_CONTACT_URL;

export function ResultView({ data, companyName, onRestart }: Props) {
  const { result, report, aiGenerated } = data;
  const { readiness, totals } = result;
  const topIds = new Set(result.top.map((t) => t.taskId));
  const recommendationByTask = new Map(
    report.recommendations.map((r) => [r.taskId, r]),
  );
  const headingRef = useRef<HTMLHeadingElement>(null);

  // 診断ボタンは結果表示で消えるため、見出しにフォーカスを移して結果が出たことを伝える
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <article className="space-y-10">
      <header className="space-y-2">
        <p className="text-sm text-muted">
          {aiGenerated
            ? "AIが回答内容をもとに個別に分析したレポートです"
            : "標準レポートです(AIによる個別分析は行っていません)"}
        </p>
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-2xl font-bold break-words focus:outline-none"
        >
          {companyName ? `${companyName}様の` : ""}AI導入診断レポート
        </h2>
      </header>

      <section aria-labelledby="hero" className="space-y-6">
        <div className="rounded-xl border border-line bg-surface p-6">
          <h3 id="hero" className="text-sm font-medium text-ink-2">
            年間の削減見込み額
          </h3>
          <p className="mt-1 text-5xl font-bold tracking-tight">
            {formatYen(totals.annualSavedAmount)}
          </p>
          <p className="mt-2 text-ink-2">
            年間 約{formatHours(totals.annualSavedHours)}
            の業務をAIで削減できる見込みです(入力された業務 月
            {formatHours(totals.monthlyHours)}のうち)
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile
            label="AI導入の準備度"
            value={`${readiness.score}点`}
            note={READINESS_LEVEL_LABEL[readiness.level]}
          />
          <StatTile
            label="優先施策の初期費用(目安)"
            value={formatYen(totals.topInitialCost)}
            note={`上位${result.top.length}施策の合計`}
          />
          <StatTile
            label="優先施策の年間運用費(目安)"
            value={formatYen(totals.topAnnualRunningCost)}
            note={`削減見込み 年${formatYen(totals.topAnnualSavedAmount)}`}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-lg font-bold">総評</h3>
        <p className="leading-relaxed text-ink-2">{report.summary}</p>
      </section>

      <section className="space-y-4 rounded-xl border border-line bg-surface p-6">
        <div>
          <h3 className="text-lg font-bold">業務別の年間削減見込み額</h3>
          <p className="text-sm text-muted">
            棒にカーソルを合わせると、月あたりの削減時間を表示します
          </p>
        </div>
        <SavingsChart tasks={result.tasks} topIds={topIds} />
      </section>

      <section className="space-y-4">
        <h3 className="text-lg font-bold">優先して取り組む施策</h3>
        <ol className="space-y-4">
          {result.top.map((t, i) => {
            const rec = recommendationByTask.get(t.taskId);
            if (!rec) return null;
            return (
              <li
                key={t.taskId}
                className="space-y-4 rounded-xl border border-line bg-surface p-6"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-sm font-semibold text-accent-ink">
                    優先度 {i + 1}
                  </span>
                  <h4 className="text-lg font-bold">{rec.title}</h4>
                  <span className="text-sm text-muted">{t.name}</span>
                </div>
                <dl className="grid grid-cols-2 gap-3 rounded-lg bg-surface-2 p-4 text-sm sm:grid-cols-4">
                  <Metric label="月の削減時間" value={formatHours(t.monthlySavedHours)} />
                  <Metric label="年間削減額" value={formatYen(t.annualSavedAmount)} />
                  <Metric label="難易度" value={DIFFICULTY_LABEL[t.difficulty]} />
                  <Metric
                    label="投資回収"
                    value={
                      t.paybackMonths === null
                        ? "回収困難"
                        : `約${t.paybackMonths}ヶ月`
                    }
                  />
                </dl>
                <p className="leading-relaxed text-ink-2">{rec.approach}</p>
                <div className="flex flex-wrap gap-2">
                  {rec.tools.map((tool, j) => (
                    <span
                      key={j}
                      className="rounded-full border border-line px-3 py-1 text-xs text-ink-2"
                    >
                      {tool}
                    </span>
                  ))}
                </div>
                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <p className="font-semibold">最初の一歩</p>
                    <p className="text-ink-2">{rec.firstStep}</p>
                  </div>
                  <div>
                    <p className="font-semibold">注意点</p>
                    <p className="text-ink-2">{rec.caution}</p>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="space-y-4">
        <h3 className="text-lg font-bold">3ヶ月のロードマップ</h3>
        <ol className="grid gap-4 md:grid-cols-3">
          {report.roadmap.map((phase, i) => (
            <li
              key={i}
              className="space-y-2 rounded-xl border border-line bg-surface p-5"
            >
              <p className="text-sm font-semibold text-accent-ink">
                {phase.period}
              </p>
              <p className="font-bold">{phase.goal}</p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
                {phase.actions.map((a, j) => (
                  <li key={j}>{a}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4 rounded-xl border border-line bg-surface p-6">
          <h3 className="text-lg font-bold">
            準備度の内訳({readiness.score}点 / 100点)
          </h3>
          <ul className="space-y-3">
            {readiness.breakdown.map((b) => (
              <li key={b.id} className="space-y-1 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{b.label}</span>
                  <span className="tabular-nums text-ink-2">
                    {Math.round(b.weightedScore)} / {b.weight}
                  </span>
                </div>
                <div
                  className="h-2 rounded-full bg-track"
                  role="meter"
                  aria-label={b.label}
                  aria-valuemin={0}
                  aria-valuemax={3}
                  aria-valuenow={b.points}
                >
                  <div
                    className="h-2 rounded-full bg-series-1"
                    style={{ width: `${(b.points / 3) * 100}%` }}
                  />
                </div>
                <p className="text-muted">{b.answer}</p>
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-3 rounded-xl border border-line bg-surface p-6">
          <h3 className="text-lg font-bold">導入前に整えたいこと</h3>
          <ul className="list-disc space-y-2 pl-5 text-ink-2">
            {report.readinessAdvice.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-lg font-bold">試算の内訳</h3>
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-surface-2 text-left text-ink-2">
              <tr>
                <th className="px-4 py-2 font-medium">業務</th>
                <th className="px-4 py-2 text-right font-medium">現在(月)</th>
                <th className="px-4 py-2 text-right font-medium">削減率</th>
                <th className="px-4 py-2 text-right font-medium">削減(月)</th>
                <th className="px-4 py-2 text-right font-medium">削減額(年)</th>
                <th className="px-4 py-2 font-medium">難易度</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line tabular-nums">
              {result.tasks.map((t) => (
                <tr key={t.taskId}>
                  <td className="px-4 py-2">
                    {t.name}
                    {t.prerequisiteGap && (
                      <span className="ml-1 text-xs text-muted">※前提条件の整備が必要</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">{formatHours(t.monthlyHours)}</td>
                  <td className="px-4 py-2 text-right">
                    {Math.round(t.automationRate * 100)}%
                  </td>
                  <td className="px-4 py-2 text-right">
                    {formatHours(t.monthlySavedHours)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {formatYen(t.annualSavedAmount)}
                  </td>
                  <td className="px-4 py-2">{DIFFICULTY_LABEL[t.difficulty]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs leading-relaxed text-muted">
          削減時間 = 現在の工数 × 業務ごとの削減率 × 実現係数({result.realizationFactor}
          。準備度に応じて0.5〜1.0)。費用は難易度ごとの目安(低:初期
          {formatYen(COST_BY_DIFFICULTY[1].initial)}・月
          {formatYen(COST_BY_DIFFICULTY[1].monthly)}、中:初期
          {formatYen(COST_BY_DIFFICULTY[2].initial)}・月
          {formatYen(COST_BY_DIFFICULTY[2].monthly)}、高:初期
          {formatYen(COST_BY_DIFFICULTY[3].initial)}・月
          {formatYen(COST_BY_DIFFICULTY[3].monthly)}
          )です。試算は入力内容と一般的な目安にもとづく概算で、効果を保証するものではありません。
        </p>
      </section>

      <section className="space-y-4 rounded-xl border-2 border-accent bg-accent-soft p-6">
        <h3 className="text-lg font-bold">専門家と一緒に深掘りしたいポイント</h3>
        <ul className="list-disc space-y-1 pl-5 text-ink-2">
          {report.discussionPoints.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
        {CONTACT_URL && (
          <a
            href={CONTACT_URL}
            className="no-print inline-block rounded-md bg-accent-strong px-5 py-2.5 font-semibold text-white hover:opacity-90"
          >
            無料相談を申し込む
          </a>
        )}
      </section>

      <div className="no-print flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-md border border-line bg-surface px-4 py-2 font-medium hover:bg-surface-2"
        >
          印刷・PDFで保存
        </button>
        <button
          type="button"
          onClick={onRestart}
          className="rounded-md border border-line bg-surface px-4 py-2 font-medium hover:bg-surface-2"
        >
          入力内容を修正して再診断
        </button>
      </div>
    </article>
  );
}

function StatTile({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <p className="text-sm text-ink-2">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-sm text-muted">{note}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}
