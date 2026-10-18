import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Card, Loading } from "@/components/ui";
import { getDeps } from "@/lib/deps";
import { formatYen } from "@/lib/format";

export default function CrmMockPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Salesforce(モック)</h1>
        <p className="text-ink-2">
          モック接続で登録した商談と見積です。本番接続(環境変数 SF_INSTANCE_URL・SF_CLIENT_ID・SF_CLIENT_SECRET を設定)では、同じ内容を Salesforce の REST API で作成します。
        </p>
      </div>
      <Suspense fallback={<Loading />}>
        <Records />
      </Suspense>
    </div>
  );
}

async function Records() {
  await connection();
  const records = (await getDeps().storage.mockCrm.list()).toReversed();
  if (records.length === 0) return <p className="text-sm text-muted">まだ登録はありません。</p>;
  return (
    <ul className="space-y-4" aria-label="登録された商談">
      {records.map((r) => (
        <li key={r.opportunity.Id} id={r.opportunity.Id} className="scroll-mt-20">
          <Card className="space-y-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="rounded bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-ink">商談</span>
              <h2 className="text-lg font-bold">{String(r.opportunity.Name)}</h2>
              <span className="text-sm text-muted">{r.opportunity.Id}</span>
            </div>
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
              <dt className="text-ink-2">フェーズ</dt>
              <dd>{String(r.opportunity.StageName)}</dd>
              <dt className="text-ink-2">金額</dt>
              <dd className="tabular-nums">{formatYen(Number(r.opportunity.Amount))}</dd>
              <dt className="text-ink-2">完了予定日</dt>
              <dd>{String(r.opportunity.CloseDate)}</dd>
              <dt className="text-ink-2">取引先</dt>
              <dd>{r.opportunity.AccountId ? String(r.opportunity.AccountId) : "未設定(新規顧客)"}</dd>
              <dt className="text-ink-2">見積</dt>
              <dd>
                {String(r.quote.Name)}({r.quote.Id}、有効期限 {String(r.quote.ExpirationDate)})
              </dd>
              <dt className="text-ink-2">登録元</dt>
              <dd>
                <Link href={`/inquiries/${r.inquiryId}/crm`} className="text-accent-ink hover:underline">
                  見積アシストの引き合い
                </Link>
              </dd>
            </dl>
            <details className="text-sm">
              <summary className="cursor-pointer text-ink-2">説明欄(明細)</summary>
              <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-ink-2">{String(r.quote.Description)}</pre>
            </details>
          </Card>
        </li>
      ))}
    </ul>
  );
}
