import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Card, Loading, StatTile, buttonPrimary } from "@/components/ui";
import { BACKLOG_STATUS_LABEL } from "@/lib/domain/reference";
import { INQUIRY_STATUS_LABEL } from "@/lib/domain/inquiry";
import { getDeps } from "@/lib/deps";
import { formatDate, formatDuration, formatPercent, formatYen } from "@/lib/format";
import { cycleHours, OVERRUN_RATE } from "@/lib/similar/search";
import { adoptionRate, summarizeMetrics } from "@/lib/views";

export default function Home() {
  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">見積待ち一覧</h1>
          <p className="max-w-3xl text-ink-2">
            引き合いメールと図面を登録すると、AIが要件と確認事項を整理し、過去の類似案件と単価表から見積の根拠と見積書案を作ります。金額はプログラムで計算し、最終判断は担当者が行います。
          </p>
        </div>
        <Link href="/inquiries/new" className={buttonPrimary}>
          新しい引き合いを登録
        </Link>
      </section>
      <Suspense fallback={<Loading />}>
        <Dashboard />
      </Suspense>
    </div>
  );
}

async function Dashboard() {
  await connection();
  const deps = getDeps();
  const [ref, inquiries] = await Promise.all([deps.reference(), deps.storage.inquiries.list()]);
  const { cases, backlog } = ref;

  const waiting = backlog.filter((b) => b.status !== "answered");
  const presidentWaiting = backlog.filter((b) => b.status === "president_review");
  const avgDays = cases.reduce((s, c) => s + c.responseDays, 0) / cases.length;
  const decided = cases.filter((c) => c.result !== "pending");
  const won = cases.filter((c) => c.result === "won");
  const overrun = won.filter((c) => cycleHours(c.actualProcesses ?? []) > cycleHours(c.estimatedProcesses) * (1 + OVERRUN_RATE));

  const processed = inquiries.map((i) => ({ i, m: summarizeMetrics(i), adoption: adoptionRate(i) }));
  const adoptions = processed.map((p) => p.adoption).filter((a): a is number => a !== null);
  const avg = (values: number[]) => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0);

  return (
    <div className="space-y-8">
      <section aria-label="現状の指標" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="見積待ち"
          value={`${backlog.length}件`}
          note={`うち${presidentWaiting.length}件が社長・工場長の確認待ち(回答前 ${waiting.length}件)`}
        />
        <StatTile label="平均回答日数" value={`${avgDays.toFixed(1)}日`} note={`過去案件${cases.length}件の引き合い〜回答`} />
        <StatTile
          label="見積受注率"
          value={formatPercent(won.length / decided.length)}
          note={`受注${won.length}件 / 回答済み${decided.length}件`}
        />
        <StatTile
          label="実績が見積を超えた案件"
          value={formatPercent(overrun.length / won.length)}
          note={`1個あたり工数が見積+${OVERRUN_RATE * 100}%超(${overrun.length}件 / 受注${won.length}件)`}
        />
      </section>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold">見積アシストで処理した引き合い</h2>
          {processed.length > 0 && (
            <p className="text-sm text-ink-2">
              1件あたり 処理時間 {formatDuration(avg(processed.map((p) => p.m.totalMs)))}・AI費用 概算
              {formatYen(avg(processed.map((p) => p.m.costJpy)))}
              {adoptions.length > 0 && `・工数案の採用率 ${formatPercent(avg(adoptions))}`}
            </p>
          )}
        </div>
        {inquiries.length === 0 ? (
          <p className="text-sm text-muted">まだありません。「新しい引き合いを登録」から始めてください。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-ink-2">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3 font-medium">受付</th>
                  <th className="py-2 pr-3 font-medium">顧客</th>
                  <th className="py-2 pr-3 font-medium">品名・図番</th>
                  <th className="py-2 pr-3 font-medium">確認事項</th>
                  <th className="py-2 pr-3 font-medium">状態</th>
                  <th className="py-2 pr-3 text-right font-medium">見積金額</th>
                </tr>
              </thead>
              <tbody>
                {processed.map(({ i }) => (
                  <tr key={i.id} className="border-b border-line last:border-0">
                    <td className="py-2 pr-3 tabular-nums">{formatDate(i.createdAt)}</td>
                    <td className="py-2 pr-3">{i.extraction.spec.customerName ?? "未確定"}</td>
                    <td className="py-2 pr-3">
                      <Link href={`/inquiries/${i.id}`} className="text-accent-ink hover:underline">
                        {i.extraction.spec.partName ?? "品名未確定"} {i.extraction.spec.drawingNumber ?? ""}
                      </Link>
                    </td>
                    <td className="py-2 pr-3">{i.extraction.questions.length}件</td>
                    <td className="py-2 pr-3">{INQUIRY_STATUS_LABEL[i.status]}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{i.approved ? formatYen(i.approved.total) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="space-y-4">
        <div>
          <h2 className="text-lg font-bold">見積待ち(デモ用の架空データ)</h2>
          <p className="text-sm text-muted">見積が社長・工場長に集中している現状のイメージです。</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-ink-2">
              <tr className="border-b border-line">
                <th className="py-2 pr-3 font-medium">受付日</th>
                <th className="py-2 pr-3 font-medium">顧客</th>
                <th className="py-2 pr-3 font-medium">品名</th>
                <th className="py-2 pr-3 text-right font-medium">数量</th>
                <th className="py-2 pr-3 font-medium">状態</th>
                <th className="py-2 pr-3 font-medium">担当</th>
              </tr>
            </thead>
            <tbody>
              {backlog.map((b) => (
                <tr key={b.id} className="border-b border-line last:border-0">
                  <td className="py-2 pr-3 tabular-nums">{formatDate(b.receivedAt)}</td>
                  <td className="py-2 pr-3">{b.customerName}</td>
                  <td className="py-2 pr-3">{b.partName}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{b.quantity}</td>
                  <td className={`py-2 pr-3 ${b.status === "president_review" ? "font-semibold text-warning" : ""}`}>
                    {BACKLOG_STATUS_LABEL[b.status]}
                  </td>
                  <td className="py-2 pr-3">{b.assignee}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
