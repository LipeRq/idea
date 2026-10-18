import Link from "next/link";
import { Suspense } from "react";
import { ModeBadge } from "./ModeBadge";

const NAV = [
  { href: "/", label: "見積待ち一覧" },
  { href: "/inquiries/new", label: "引き合い登録" },
  { href: "/rates", label: "単価表" },
  { href: "/crm-mock", label: "Salesforce(モック)" },
];

export function AppHeader() {
  return (
    <header className="no-print border-b border-line bg-surface">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="text-lg font-bold">見積アシスト</span>
          <span className="text-xs text-muted">株式会社しらかば精工(デモ)</span>
        </Link>
        <nav aria-label="メイン" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="text-ink-2 hover:text-accent-ink hover:underline">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto">
          <Suspense fallback={null}>
            <ModeBadge />
          </Suspense>
        </div>
      </div>
    </header>
  );
}
