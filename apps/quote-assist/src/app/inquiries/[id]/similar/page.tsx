import Link from "next/link";
import { Suspense } from "react";
import { InquiryFrame } from "@/components/InquiryFrame";
import { Card, Loading, Notice, buttonPrimary } from "@/components/ui";
import { formatDimensions, treatmentLabel } from "@/lib/extraction/normalize";
import { formatDate, formatHours, formatYen } from "@/lib/format";
import { cycleHours } from "@/lib/similar/search";
import { loadInquiryView } from "@/lib/views";

export default function SimilarPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<Loading />}>
      <Content params={params} />
    </Suspense>
  );
}

const RESULT_LABEL = { won: "受注", lost: "失注", pending: "回答待ち" } as const;

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { inquiry, ref } = await loadInquiryView(id);
  const similar = inquiry.similar;

  return (
    <InquiryFrame inquiry={inquiry} step="similar">
      {!similar ? (
        <Notice level="info">
          まだ検索していません。<Link href={`/inquiries/${id}`} className="underline">抽出結果</Link>
          の画面で「類似案件を検索して工数案を作る」を押してください。
        </Notice>
      ) : (
        <>
          <p className="text-sm text-ink-2">
            過去案件{ref.cases.length}件から、材質・加工種別・大きさ・図番・公差・表面処理・品名の似ている順に表示しています。
            {similar.mode === "ai" ? "並べ替えと説明はAIが行いました。" : "並び順は属性スコア順です(AIは使っていません)。"}
          </p>
          {similar.cases.length === 0 && <Notice level="warning">似た過去案件が見つかりませんでした。工数は人が入力してください。</Notice>}
          <ol className="space-y-4" aria-label="類似案件">
            {similar.cases.map((s, i) => {
              const c = ref.cases.find((x) => x.id === s.caseId);
              if (!c) return null;
              const customer = ref.customers.find((x) => x.id === c.customerId);
              const est = cycleHours(c.estimatedProcesses);
              const act = c.actualProcesses ? cycleHours(c.actualProcesses) : null;
              return (
                <li key={s.caseId}>
                  <Card className="space-y-4">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="text-sm font-semibold text-accent-ink">類似 {i + 1}</span>
                      <h2 className="text-lg font-bold">
                        <Link href={`/cases/${c.id}`} className="hover:underline">
                          {c.partName} {c.drawingNumber} Rev.{c.revision}
                        </Link>
                      </h2>
                      <span className="text-sm text-muted">
                        {c.id}・{customer?.shortName}・{formatDate(c.quotedAt)}
                      </span>
                      <span className="ml-auto text-sm font-semibold tabular-nums">スコア {s.score}</span>
                    </div>
                    <div
                      role="meter"
                      aria-label={`${c.id}の類似度スコア`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={s.score}
                      className="h-2 rounded-full bg-track"
                    >
                      <div className="h-2 rounded-full bg-series-1" style={{ width: `${Math.min(100, s.score)}%` }} />
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2 text-sm">
                        <p className="font-semibold">似ている理由</p>
                        <ul className="list-disc space-y-1 pl-5 text-ink-2">
                          {s.reasons.map((r) => (
                            <li key={r}>{r}</li>
                          ))}
                        </ul>
                        {s.aiReason && (
                          <p className="rounded-md bg-accent-soft px-3 py-2 text-accent-ink">AIの説明:{s.aiReason}</p>
                        )}
                        <p className="text-xs text-muted">
                          内訳:{s.breakdown.filter((b) => b.points > 0).map((b) => `${b.label} ${b.points}/${b.max}`).join("・")}
                        </p>
                      </div>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                        <dt className="text-ink-2">材質・寸法</dt>
                        <dd>
                          {c.materialId}・{formatDimensions(c.dimensions)}
                        </dd>
                        <dt className="text-ink-2">公差・処理</dt>
                        <dd>
                          ±{c.toleranceMm}・{treatmentLabel(c.surfaceTreatmentId ?? "none", ref.rates)}
                          {c.heatTreatmentId ? `・${treatmentLabel(c.heatTreatmentId, ref.rates)}` : ""}
                        </dd>
                        <dt className="text-ink-2">当時の見積</dt>
                        <dd className="tabular-nums">
                          {c.quantity}個 × {formatYen(c.unitPrice)} = {formatYen(c.amount)}
                        </dd>
                        <dt className="text-ink-2">工数(1個あたり)</dt>
                        <dd className="tabular-nums">
                          見積 {formatHours(est)}
                          {act !== null ? ` → 実績 ${formatHours(act)}` : "(実績なし)"}
                        </dd>
                        <dt className="text-ink-2">結果</dt>
                        <dd>
                          {RESULT_LABEL[c.result]}
                          {c.lostReason ? `(${c.lostReason})` : ""}・回答{c.responseDays}日
                        </dd>
                      </dl>
                    </div>
                    {s.warnings.length > 0 && (
                      <ul className="space-y-2">
                        {s.warnings.map((w) => (
                          <li key={w}>
                            <Notice level="warning">{w}</Notice>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                </li>
              );
            })}
          </ol>
          <div>
            <Link href={`/inquiries/${id}/quote`} className={buttonPrimary}>
              見積根拠へ進む
            </Link>
          </div>
        </>
      )}
    </InquiryFrame>
  );
}
