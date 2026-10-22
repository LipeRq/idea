import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import {
  AdoptionSection,
  ComparisonTable,
  ContextBanner,
  DefinitionsSection,
  HonestyNotes,
  SectionTitle,
  SupplementaryTable,
  TrendGrid,
} from "@/components/impact/sections";
import { PrintButton } from "@/components/PrintButton";
import { Loading, buttonSecondary } from "@/components/ui";
import { getDeps } from "@/lib/deps";
import { formatDate } from "@/lib/format";
import { loadImpactView, parseGranularity, parseSource } from "@/lib/impact/load";

// PoCの報告会にそのまま使える、印刷向けの報告書(ブラウザの「印刷」から紙・PDFにする)

export default function ReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <Suspense fallback={<Loading />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function Content({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const sp = await searchParams;
  const granularity = parseGranularity(first(sp.g));
  const view = await loadImpactView(getDeps(), { source: parseSource(first(sp.source)), granularity });
  const { report } = view;
  const query = new URLSearchParams({ g: granularity, source: view.source }).toString();

  return (
    <article className="report space-y-6" data-testid="impact-report">
      <div className="no-print flex flex-wrap items-center gap-2">
        <Link href={`/dashboard?${query}`} className={buttonSecondary}>
          ダッシュボードに戻る
        </Link>
        <PrintButton />
        <a className={buttonSecondary} href={`/api/impact/export?format=md&${query}`}>
          Markdownで書き出す
        </a>
        <a className={buttonSecondary} href={`/api/impact/export?format=csv&part=summary&${query}`}>
          CSVで書き出す
        </a>
      </div>

      <header className="space-y-2 border-b border-line-strong pb-4">
        <p className="text-sm text-ink-2">見積アシスト 試験導入(PoC)</p>
        <h1 className="text-2xl font-bold">効果測定の報告書(試験導入期間の実測値)</h1>
        <p className="text-sm text-ink-2">作成日 {formatDate(report.generatedOn)}</p>
        <ContextBanner view={view} />
        <p className="text-sm text-ink-2">
          見積担当者の名簿:{report.estimators.length > 0 ? report.estimators.join("、") : "(未設定)"}
        </p>
      </header>

      <section className="space-y-3">
        <SectionTitle>1. 導入前後の比較</SectionTitle>
        <ComparisonTable report={report} />
        <SupplementaryTable report={report} />
      </section>

      <section className="report-block space-y-3">
        <SectionTitle>2. 推移({granularity === "week" ? "週ごと" : "月ごと"}、導入後)</SectionTitle>
        <TrendGrid report={report} />
      </section>

      <section className="report-block space-y-3">
        <SectionTitle>3. AI案の採用率・修正率(項目別)</SectionTitle>
        <AdoptionSection report={report} />
      </section>

      <section className="space-y-3">
        <SectionTitle>4. 指標の定義と計算式</SectionTitle>
        <DefinitionsSection />
      </section>

      <section className="report-block space-y-3">
        <SectionTitle>5. 読むときの注意</SectionTitle>
        <HonestyNotes />
      </section>
    </article>
  );
}
