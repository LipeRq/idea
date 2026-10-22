import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import {
  AdoptionSection,
  ComparisonTable,
  ContextBanner,
  DefinitionsSection,
  HonestyNotes,
  KpiTiles,
  SectionTitle,
  SegmentedLinks,
  SupplementaryTable,
  TrendGrid,
} from "@/components/impact/sections";
import { Card, Loading, Notice, buttonPrimary, buttonSecondary } from "@/components/ui";
import { getDeps } from "@/lib/deps";
import { MIN_RELIABLE_N } from "@/lib/impact/kpi";
import { loadImpactView, parseGranularity, parseSource } from "@/lib/impact/load";

export default function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
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

  const href = (over: { g?: string; source?: string }) => {
    const q = new URLSearchParams({ g: over.g ?? granularity, source: over.source ?? view.source });
    return `/dashboard?${q.toString()}`;
  };
  const exportQuery = new URLSearchParams({ g: granularity, source: view.source }).toString();

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">効果測定ダッシュボード</h1>
          <p className="max-w-3xl text-ink-2">
            試験導入(PoC)の期間に実測した値を、導入前(ベースライン)と比べます。導入後の値は、見積アシストの記録から決まった計算式で出しています(AIに数字は作らせていません)。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/dashboard/report?${exportQuery}`} className={buttonPrimary}>
            報告書を開く(印刷・PDF)
          </Link>
          <Link href="/dashboard/baseline" className={buttonSecondary}>
            ベースラインを入力・取り込む
          </Link>
        </div>
      </section>

      {/* 絞り込みは1行にまとめ、下の指標・グラフ・表のすべてに効く */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3" aria-label="集計の条件" role="group">
        <SegmentedLinks
          label="推移の単位"
          options={[
            { href: href({ g: "week" }), text: "週ごと", current: granularity === "week" },
            { href: href({ g: "month" }), text: "月ごと", current: granularity === "month" },
          ]}
        />
        {view.demoAvailable && (
          <SegmentedLinks
            label="導入後のデータ"
            options={[
              { href: href({ source: "demo" }), text: "デモ用の架空の記録", current: view.source === "demo" },
              { href: href({ source: "app" }), text: "このアプリの実際の記録", current: view.source === "app" },
            ]}
          />
        )}
      </div>

      <ContextBanner view={view} />
      {view.baselineOrigin === "none" && (
        <Notice level="warning">
          ベースライン(導入前の記録)がまだありません。導入前との比較はできません。
          <Link href="/dashboard/baseline" className="ml-1 font-semibold underline">
            ベースラインを入力する
          </Link>
        </Notice>
      )}
      {report.post.kpis.cases === 0 && (
        <Notice level="info">導入後の記録がまだありません。引き合いを登録して見積を承認すると、ここに集計されます。</Notice>
      )}
      <p className="text-sm text-muted">
        数字は「試験導入期間の実測値」です。件数が{MIN_RELIABLE_N}件に満たない値には「参考値」と表示します。効果の断定はしません(読み方は下の注意をご覧ください)。
      </p>

      <KpiTiles report={report} />

      <Card className="space-y-4">
        <SectionTitle note="導入前は記録シートの全期間、導入後は上の「導入後のデータ」全期間で計算しています。表示は四捨五入で、差は丸める前の値から計算するため、表示の引き算と1ずれることがあります。">導入前後の比較</SectionTitle>
        <ComparisonTable report={report} />
      </Card>

      <Card className="space-y-4">
        <SectionTitle note={`導入後の推移です。灰色の破線は導入前の値、○は参考値(件数が${MIN_RELIABLE_N}件未満)。受付日で集計するため、直近の期間は回答・結果の記録がまだ少なく出ます。`}>
          推移({granularity === "week" ? "週ごと" : "月ごと"})
        </SectionTitle>
        <TrendGrid report={report} />
      </Card>

      <Card className="space-y-4">
        <SectionTitle note="承認した見積について、AI案を人が変えずに採用した割合です。修正されやすい項目が上に並びます。">AI案の採用率・修正率(項目別)</SectionTitle>
        <AdoptionSection report={report} />
      </Card>

      <Card className="space-y-4">
        <SectionTitle>補助の値</SectionTitle>
        <SupplementaryTable report={report} />
      </Card>

      <Card className="space-y-4">
        <SectionTitle>書き出し</SectionTitle>
        <div className="flex flex-wrap gap-2 text-sm">
          <a className={buttonSecondary} href={`/api/impact/export?format=md&${exportQuery}`}>
            報告書(Markdown)
          </a>
          <a className={buttonSecondary} href={`/api/impact/export?format=csv&part=summary&${exportQuery}`}>
            導入前後の比較(CSV)
          </a>
          <a className={buttonSecondary} href={`/api/impact/export?format=csv&part=trend&${exportQuery}`}>
            推移(CSV)
          </a>
          <a className={buttonSecondary} href={`/api/impact/export?format=csv&part=adoption&${exportQuery}`}>
            項目別の採用率(CSV)
          </a>
        </div>
      </Card>

      <section className="space-y-4" aria-labelledby="defs-title">
        <h2 id="defs-title" className="text-lg font-bold">
          指標の定義と計算式
        </h2>
        <DefinitionsSection />
      </section>

      <section className="space-y-3" aria-labelledby="notes-title">
        <h2 id="notes-title" className="text-lg font-bold">
          読むときの注意
        </h2>
        <HonestyNotes />
      </section>
    </div>
  );
}
