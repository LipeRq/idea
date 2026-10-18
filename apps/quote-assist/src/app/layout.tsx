import type { Metadata } from "next";
import { AppHeader } from "@/components/AppHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: "見積アシスト",
  description:
    "引き合いメールと図面から要件と確認事項を整理し、過去の類似案件と単価表をもとに見積の根拠と見積書案を作る、部品加工業向けのAIアシスタントです。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <AppHeader />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
        <footer className="no-print mx-auto w-full max-w-6xl px-4 pb-8 text-xs text-muted">
          デモ用の合成データ(架空の会社「株式会社しらかば精工」)で動作しています。社名・人名・図面はすべて架空です。金額は単価表に基づく計算で、最終判断と送信は担当者が行います。
        </footer>
      </body>
    </html>
  );
}
