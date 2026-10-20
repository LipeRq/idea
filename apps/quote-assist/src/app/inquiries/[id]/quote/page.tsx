import Link from "next/link";
import { Suspense } from "react";
import { InquiryFrame } from "@/components/InquiryFrame";
import { QuoteEditor } from "@/components/QuoteEditor";
import { Loading, Notice } from "@/components/ui";
import { todayJst } from "@/lib/dates";
import { unconfirmedFields } from "@/lib/extraction/rules";
import { loadInquiryView } from "@/lib/views";

export default function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<Loading />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { inquiry, ref } = await loadInquiryView(id);
  const { quote, estimate, similar } = inquiry;
  if (!quote || !estimate) {
    return (
      <InquiryFrame inquiry={inquiry} step="quote">
        <Notice level="info">
          まだ見積がありません。<Link href={`/inquiries/${id}`} className="underline">抽出結果</Link>
          の画面で「類似案件を検索して工数案を作る」を押してください。
        </Notice>
      </InquiryFrame>
    );
  }
  const caseIds = new Set(similar?.cases.map((s) => s.caseId) ?? []);
  return (
    <InquiryFrame inquiry={inquiry} step="quote">
      <QuoteEditor
        // 画面は遷移後も保持されるので、保存した内容が変わったら作り直す
        key={`${quote.updatedAt}:${inquiry.status}`}
        inquiryId={inquiry.id}
        rates={ref.rates}
        company={ref.company}
        spec={inquiry.extraction.spec}
        initial={inquiry.approved?.input ?? quote.input}
        proposal={estimate.proposal}
        rationales={estimate.rationales}
        estimateMode={estimate.mode}
        similar={similar?.cases ?? []}
        cases={ref.cases.filter((c) => caseIds.has(c.id))}
        assumptions={estimate.assumptions}
        risks={estimate.risks}
        memo={estimate.memo}
        today={todayJst(new Date(inquiry.createdAt))}
        status={inquiry.status}
        unconfirmed={unconfirmedFields(inquiry.extraction.fields)}
      />
    </InquiryFrame>
  );
}
