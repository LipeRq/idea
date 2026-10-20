import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "ページが見つかりません",
};

export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-4 py-16 sm:py-24">
      <p className="text-sm font-semibold text-accent-ink">404 Not Found</p>
      <h1 className="text-3xl font-bold leading-tight sm:text-4xl">ページが見つかりません</h1>
      <p className="max-w-2xl leading-relaxed text-ink-2">
        お探しのページは、移動または削除された可能性があります。URLをご確認いただくか、診断ページからお進みください。
      </p>
      <Link
        href="/"
        className="inline-block rounded-md bg-accent-strong px-6 py-2.5 font-semibold text-white hover:opacity-90"
      >
        無料のAI導入診断へ
      </Link>
    </main>
  );
}
