import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Card, Loading, Notice } from "@/components/ui";
import { PROCESS_TYPE_LABEL } from "@/lib/domain/reference";
import { getDeps } from "@/lib/deps";
import { formatDimensions, treatmentLabel } from "@/lib/extraction/normalize";
import { formatDate, formatNumber, formatYen } from "@/lib/format";
import { caseWarnings, cycleHours } from "@/lib/similar/search";

export default function CasePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<Loading />}>
      <Content params={params} />
    </Suspense>
  );
}

const RESULT_LABEL = { won: "受注", lost: "失注", pending: "回答待ち" } as const;

async function Content({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const ref = await getDeps().reference();
  const c = ref.cases.find((x) => x.id === id);
  if (!c) notFound();
  const customer = ref.customers.find((x) => x.id === c.customerId);
  const defects = ref.defects.filter((d) => c.defectIds.includes(d.id));
  const processName = (pid: string) => ref.rates.processes.find((p) => p.id === pid)?.name ?? pid;
  const warnings = caseWarnings(c, ref.defects);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-sm text-muted">過去案件 {c.id}(合成データ)</p>
        <h1 className="text-2xl font-bold">
          {c.partName} {c.drawingNumber} Rev.{c.revision}
        </h1>
        <p className="text-ink-2">
          {customer?.name}・見積日 {formatDate(c.quotedAt)}・{RESULT_LABEL[c.result]}
          {c.lostReason ? `(${c.lostReason})` : ""}
        </p>
      </div>
      {warnings.map((w) => (
        <Notice key={w} level="warning">
          {w}
        </Notice>
      ))}
      <Card>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="font-semibold">加工種別</dt>
          <dd>{PROCESS_TYPE_LABEL[c.processType]}</dd>
          <dt className="font-semibold">材質・寸法・重量</dt>
          <dd>
            {c.materialId}・{formatDimensions(c.dimensions)}・{formatNumber(c.weightKg, 3)}kg
          </dd>
          <dt className="font-semibold">最小公差</dt>
          <dd>±{c.toleranceMm}</dd>
          <dt className="font-semibold">表面処理・熱処理</dt>
          <dd>
            {treatmentLabel(c.surfaceTreatmentId ?? "none", ref.rates)}・{treatmentLabel(c.heatTreatmentId ?? "none", ref.rates)}
          </dd>
          <dt className="font-semibold">形状特徴</dt>
          <dd>{c.features.join("、") || "—"}</dd>
          <dt className="font-semibold">見積</dt>
          <dd>
            {c.quantity}個 × {formatYen(c.unitPrice)} = {formatYen(c.amount)}(回答まで{c.responseDays}日)
          </dd>
          {c.notes && (
            <>
              <dt className="font-semibold">メモ</dt>
              <dd>{c.notes}</dd>
            </>
          )}
        </dl>
      </Card>
      <Card className="space-y-3">
        <h2 className="text-lg font-bold">工程別の工数(見積と実績)</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm" aria-label="工程別の工数">
            <thead className="text-left text-ink-2">
              <tr className="border-b border-line">
                <th className="py-2 pr-3 font-medium">工程</th>
                <th className="py-2 pr-3 text-right font-medium">見積 段取り</th>
                <th className="py-2 pr-3 text-right font-medium">見積 1個</th>
                <th className="py-2 pr-3 text-right font-medium">実績 段取り</th>
                <th className="py-2 text-right font-medium">実績 1個</th>
              </tr>
            </thead>
            <tbody>
              {c.estimatedProcesses.map((p) => {
                const a = c.actualProcesses?.find((x) => x.processId === p.processId);
                return (
                  <tr key={p.processId} className="border-b border-line">
                    <th scope="row" className="py-2 pr-3 text-left font-medium">
                      {processName(p.processId)}
                    </th>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(p.setupHours, 2)}h</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(p.cycleHoursPerPiece, 2)}h</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{a ? `${formatNumber(a.setupHours, 2)}h` : "—"}</td>
                    <td className="py-2 text-right tabular-nums">{a ? `${formatNumber(a.cycleHoursPerPiece, 2)}h` : "—"}</td>
                  </tr>
                );
              })}
              <tr>
                <th scope="row" className="py-2 pr-3 text-left font-semibold">
                  1個あたり合計
                </th>
                <td />
                <td className="py-2 pr-3 text-right font-semibold tabular-nums">{formatNumber(cycleHours(c.estimatedProcesses), 2)}h</td>
                <td />
                <td className="py-2 text-right font-semibold tabular-nums">
                  {c.actualProcesses ? `${formatNumber(cycleHours(c.actualProcesses), 2)}h` : "—"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
      {defects.length > 0 && (
        <Card className="space-y-2">
          <h2 className="text-lg font-bold">不具合履歴</h2>
          <ul className="space-y-2 text-sm">
            {defects.map((d) => (
              <li key={d.id}>
                <p className="font-medium">
                  {d.id} {d.category}({formatDate(d.date)})
                </p>
                <p className="text-ink-2">{d.description}</p>
                <p className="text-ink-2">対策:{d.countermeasure}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
