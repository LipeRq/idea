import Link from "next/link";
import { Suspense } from "react";
import { CrmRegisterButton } from "@/components/CrmRegisterButton";
import { InquiryFrame } from "@/components/InquiryFrame";
import { OutcomeForm } from "@/components/impact/OutcomeForm";
import { Card, Loading, Notice, StatTile } from "@/components/ui";
import { usdToJpy } from "@/lib/ai/client";
import { salesforceOptionsFromEnv } from "@/lib/crm";
import { buildSalesforcePayload } from "@/lib/crm/salesforce-payload";
import { STEP_LABEL } from "@/lib/domain/inquiry";
import { formatDuration, formatPercent, formatUsd, formatYen } from "@/lib/format";
import { adoptionRate, loadInquiryView, minutesToApprove, summarizeMetrics } from "@/lib/views";

export default function CrmPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<Loading />}>
      <Content params={params} />
    </Suspense>
  );
}

const MODE_LABEL = { ai: "AI", demo: "デモ(固定結果)", rule: "プログラム", fallback: "プログラム(類似実績)" } as const;

function Fields({ title, fields }: { title: string; fields: Record<string, unknown> }) {
  return (
    <div className="space-y-2">
      <h3 className="font-semibold">{title}</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {Object.entries(fields).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-mono text-xs text-ink-2">{k}</dt>
            <dd className="whitespace-pre-wrap break-words">{String(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { inquiry, ref, deps } = await loadInquiryView(id);
  const metrics = summarizeMetrics(inquiry);
  const adoption = adoptionRate(inquiry);
  const approveMinutes = minutesToApprove(inquiry);
  const customer = ref.customers.find((c) => c.id === inquiry.extraction.spec.customerId) ?? null;
  const payload = inquiry.approved
    ? buildSalesforcePayload({ inquiry, customer, company: ref.company, rates: ref.rates, options: salesforceOptionsFromEnv() })
    : null;

  return (
    <InquiryFrame inquiry={inquiry} step="crm">
      <Card className="space-y-4">
        <h2 className="text-lg font-bold">Salesforceへの登録(商談+見積、一方向)</h2>
        {inquiry.crm ? (
          <div className="space-y-2" data-testid="crm-result">
            <Notice level="info">
              {inquiry.crm.provider === "mock" ? "Salesforce(モック)" : "Salesforce"}に登録しました。商談 {inquiry.crm.opportunityId}・見積{" "}
              {inquiry.crm.quoteId}
            </Notice>
            {inquiry.crm.opportunityUrl && (
              <p>
                <a href={inquiry.crm.opportunityUrl} className="text-accent-ink hover:underline" target={inquiry.crm.provider === "mock" ? undefined : "_blank"} rel="noreferrer">
                  登録した商談を開く
                </a>
              </p>
            )}
          </div>
        ) : !payload ? (
          <Notice level="warning">
            見積が承認されていません。<Link href={`/inquiries/${id}/quote`} className="underline">見積根拠</Link>
            の画面で承認してから登録してください(登録は人の承認後だけ行います)。
          </Notice>
        ) : (
          <>
            <p className="text-sm text-ink-2">
              次の内容で登録します。
              {deps.crm.provider === "mock"
                ? "現在はモック接続のため、実際のSalesforceには送信しません(登録内容は「Salesforce(モック)」の画面で確認できます)。"
                : "Composite APIで商談と見積をまとめて作成します。途中で失敗した場合はどちらも作成しません。"}
              {!customer?.salesforceAccountId && " 取引先が対応づいていない顧客のため、商談は取引先なしで作成します。"}
            </p>
            <div className="grid gap-6 md:grid-cols-2">
              <Fields title="商談(Opportunity)" fields={payload.opportunity} />
              <Fields title="見積(Quote)" fields={payload.quote} />
            </div>
            <CrmRegisterButton inquiryId={inquiry.id} label={deps.crm.label} />
          </>
        )}
      </Card>

      <Card className="space-y-4">
        <h2 className="text-lg font-bold">計測(この引き合い)</h2>
        <section aria-label="計測の合計" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="処理時間の合計" value={formatDuration(metrics.totalMs)} note={`うちAI ${formatDuration(metrics.aiMs)}`} />
          <StatTile
            label="AIのトークン数"
            value={`${(metrics.inputTokens + metrics.outputTokens).toLocaleString("ja-JP")}`}
            note={`入力${metrics.inputTokens.toLocaleString("ja-JP")}・出力${metrics.outputTokens.toLocaleString("ja-JP")}・キャッシュ${metrics.cacheTokens.toLocaleString("ja-JP")}`}
          />
          <StatTile label="AIの概算費用" value={formatYen(metrics.costJpy)} note={`${formatUsd(metrics.costUsd)}(1ドル=${usdToJpy(1)}円)`} />
          <StatTile
            label="登録から承認まで"
            value={approveMinutes === null ? "—" : `${approveMinutes}分`}
            note={adoption === null ? "工数案なし" : `工数案の採用率 ${formatPercent(adoption)}`}
          />
        </section>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm" aria-label="処理ステップごとの計測">
            <thead className="text-left text-ink-2">
              <tr className="border-b border-line">
                <th className="py-2 pr-3 font-medium">手順</th>
                <th className="py-2 pr-3 font-medium">方式</th>
                <th className="py-2 pr-3 text-right font-medium">処理時間</th>
                <th className="py-2 pr-3 font-medium">モデル</th>
                <th className="py-2 pr-3 text-right font-medium">入力/出力トークン</th>
                <th className="py-2 text-right font-medium">概算費用</th>
              </tr>
            </thead>
            <tbody>
              {inquiry.metrics.map((m) => (
                <tr key={m.step} className="border-b border-line last:border-0">
                  <th scope="row" className="py-2 pr-3 text-left font-medium">
                    {STEP_LABEL[m.step]}
                  </th>
                  <td className="py-2 pr-3">{MODE_LABEL[m.mode]}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatDuration(m.durationMs)}</td>
                  <td className="py-2 pr-3">{m.model ?? "—"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {m.usage ? `${m.usage.inputTokens.toLocaleString("ja-JP")} / ${m.usage.outputTokens.toLocaleString("ja-JP")}` : "—"}
                  </td>
                  <td className="py-2 text-right tabular-nums">{m.costUsd === null ? "—" : formatUsd(m.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">
          費用は Claude Opus 5.5 の公表価格(入力4ドル・出力20ドル/100万トークン、キャッシュ書き込み5ドル・読み込み0.2ドル)での概算です。
        </p>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-bold">修正の記録({inquiry.reviewLog.length}件)</h2>
        {inquiry.reviewLog.length === 0 ? (
          <p className="text-sm text-muted">AIの案から人が変えた項目はありません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm" aria-label="修正の記録">
              <thead className="text-left text-ink-2">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3 font-medium">日時</th>
                  <th className="py-2 pr-3 font-medium">項目</th>
                  <th className="py-2 pr-3 font-medium">修正前(案)</th>
                  <th className="py-2 font-medium">修正後</th>
                </tr>
              </thead>
              <tbody>
                {inquiry.reviewLog.map((l, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    <td className="py-2 pr-3 tabular-nums">{new Date(l.at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</td>
                    <td className="py-2 pr-3">{l.label}</td>
                    <td className="py-2 pr-3">{l.before}</td>
                    <td className="py-2">{l.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {inquiry.approved && (
        <Card className="space-y-3">
          <h2 className="text-lg font-bold">結果の記録(効果測定用)</h2>
          <OutcomeForm
            inquiryId={inquiry.id}
            initial={inquiry.outcome ? { result: inquiry.outcome.result, actualCost: inquiry.outcome.actualCost, reworkCount: inquiry.outcome.reworkCount } : null}
            orderAmount={inquiry.approved.total}
          />
          <p className="text-sm">
            <Link href="/dashboard?source=app" className="text-accent-ink hover:underline">
              効果測定ダッシュボードで集計を見る
            </Link>
          </p>
        </Card>
      )}
    </InquiryFrame>
  );
}
