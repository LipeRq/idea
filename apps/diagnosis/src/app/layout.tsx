import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI導入診断",
  description:
    "業務時間とIT環境を入力するだけで、AIで削減できる業務・削減額・3ヶ月のロードマップがわかる無料診断です。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
