import Link from "next/link";
import { Suspense } from "react";
import { CopyButton } from "@/components/CopyButton";
import { InquiryFrame } from "@/components/InquiryFrame";
import { PrintButton } from "@/components/PrintButton";
import { Card, Loading, Notice, buttonPrimary, inputClass } from "@/components/ui";
import { formatJpDate } from "@/lib/dates";
import { buildQuoteDocument, buildReplyEmail } from "@/lib/documents";
import { formatYen } from "@/lib/format";
import { loadInquiryView } from "@/lib/views";

export default function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<Loading />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { inquiry, ref } = await loadInquiryView(id);
  const doc = buildQuoteDocument(inquiry, ref.rates);
  if (!doc) {
    return (
      <InquiryFrame inquiry={inquiry} step="document">
        <Notice level="info">まだ見積がありません。</Notice>
      </InquiryFrame>
    );
  }
  const spec = inquiry.extraction.spec;
  const customer = ref.customers.find((c) => c.id === spec.customerId) ?? null;
  const reply = buildReplyEmail({ inquiry, doc, company: ref.company, customer });
  const approver = inquiry.reviewLog.findLast((l) => l.key === "approve" && l.before === "未承認")?.after;
  const part = [spec.partName ?? "部品加工", spec.drawingNumber && `${spec.drawingNumber}${spec.revision ? ` Rev.${spec.revision}` : ""}`]
    .filter(Boolean)
    .join(" ");

  return (
    <InquiryFrame inquiry={inquiry} step="document">
      {!doc.approved && (
        <Notice level="warning">
          未承認の下書きです。<Link href={`/inquiries/${id}/quote`} className="underline">見積根拠</Link>
          の画面で承認すると、見積番号が付き、Salesforceに登録できるようになります。
        </Notice>
      )}
      <div className="no-print flex flex-wrap gap-3">
        <PrintButton />
        {doc.approved && (
          <Link href={`/inquiries/${id}/crm`} className={buttonPrimary}>
            Salesforceに登録する
          </Link>
        )}
      </div>

      <article aria-label="見積書" className="print-area space-y-6 rounded-xl border border-line bg-surface p-6 sm:p-10">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div className="space-y-3">
            <h2 className="text-3xl font-bold tracking-widest">御見積書{doc.approved ? "" : "(下書き)"}</h2>
            <p className="text-lg font-semibold">
              {customer?.name ?? spec.customerName ?? "ご担当者"} 御中
              {spec.contactName && <span className="block text-base font-normal">{spec.contactName} 様</span>}
            </p>
            <p className="text-sm">下記のとおりお見積り申し上げます。</p>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-ink-2">見積番号</dt>
            <dd>{doc.quoteNumber}</dd>
            <dt className="text-ink-2">発行日</dt>
            <dd>{formatJpDate(doc.issuedOn)}</dd>
            <dt className="text-ink-2">有効期限</dt>
            <dd>{formatJpDate(doc.validUntil)}</dd>
            <dt className="text-ink-2">発行</dt>
            <dd>
              {ref.company.name}
              <br />
              {ref.company.address}
              <br />
              TEL {ref.company.phone} {ref.company.salesContact}
              {approver && (
                <>
                  <br />
                  承認:{approver}
                </>
              )}
            </dd>
          </dl>
        </header>

        <div className="rounded-lg bg-surface-2 p-4">
          <p className="text-sm text-ink-2">件名:{part}</p>
          <p className="mt-1 text-2xl font-bold">
            お見積金額 <span data-testid="document-total">{formatYen(doc.totalWithTax)}</span>
            <span className="ml-2 text-sm font-normal">(消費税込み)</span>
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-ink-2">
              <tr className="border-b border-line-strong">
                <th className="py-2 pr-3 font-medium">品名・図番</th>
                <th className="py-2 pr-3 font-medium">材質</th>
                <th className="py-2 pr-3 text-right font-medium">数量</th>
                <th className="py-2 pr-3 text-right font-medium">単価</th>
                <th className="py-2 text-right font-medium">金額</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-line">
                <td className="py-2 pr-3">{part}</td>
                <td className="py-2 pr-3">{(inquiry.approved?.input ?? inquiry.quote?.input)?.material.materialId}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{doc.quantity.toLocaleString("ja-JP")}個</td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatYen(doc.unitPrice)}</td>
                <td className="py-2 text-right tabular-nums">{formatYen(doc.subtotal)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="pt-2 pr-3 text-right text-ink-2">
                  小計
                </td>
                <td className="pt-2 text-right tabular-nums" data-testid="document-subtotal">
                  {formatYen(doc.subtotal)}
                </td>
              </tr>
              <tr>
                <td colSpan={4} className="pr-3 text-right text-ink-2">
                  消費税({ref.rates.rules.taxRate * 100}%)
                </td>
                <td className="text-right tabular-nums">{formatYen(doc.tax)}</td>
              </tr>
              <tr>
                <td colSpan={4} className="pr-3 text-right font-semibold">
                  合計
                </td>
                <td className="text-right font-semibold tabular-nums">{formatYen(doc.totalWithTax)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="font-semibold">納期</dt>
          <dd>
            受注後 約{doc.standardLeadDays}営業日
            {doc.dueDate && (doc.meetsDueDate ? `(ご希望の${formatJpDate(doc.dueDate)}に対応${doc.expedite ? "・特急対応" : ""})` : `(ご希望の${formatJpDate(doc.dueDate)}は要相談)`)}
          </dd>
          <dt className="font-semibold">見積範囲</dt>
          <dd>{doc.includes.join("、")}</dd>
          <dt className="font-semibold">支払条件</dt>
          <dd>{customer?.paymentTerms ?? "別途ご相談"}</dd>
          <dt className="font-semibold">数量別単価(参考)</dt>
          <dd>{doc.tiers.map((t) => `${t.quantity}個 ${formatYen(t.unitPrice)}`).join(" / ")}</dd>
          <dt className="font-semibold">備考</dt>
          <dd className="space-y-1">
            {inquiry.extraction.questions.length > 0 && (
              <p>ご確認事項({inquiry.extraction.questions.length}件)へのご回答により、金額・納期が変わる場合がございます。</p>
            )}
            {(inquiry.estimate?.assumptions ?? []).map((a) => (
              <p key={a}>前提:{a}</p>
            ))}
            <p>検査・梱包は当社標準とします。</p>
          </dd>
        </dl>
      </article>

      <Card className="no-print space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold">
            <label htmlFor="reply-email">回答メールの案</label>
          </h2>
          <CopyButton text={reply} />
        </div>
        <p className="text-sm text-muted">送信は担当者が内容を確認してから行ってください(自動送信はしません)。</p>
        <textarea id="reply-email" readOnly value={reply} className={`${inputClass} min-h-80 font-mono text-sm`} />
      </Card>
    </InquiryFrame>
  );
}
