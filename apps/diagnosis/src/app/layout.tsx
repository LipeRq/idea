import type { Metadata, Viewport } from "next";
import { AnalyticsScripts } from "@/components/AnalyticsScripts";
import {
  OG_TITLE,
  SERVICE_NAME,
  SITE_DESCRIPTION,
  isIndexable,
  operatorName,
  siteUrl,
} from "@/lib/site";
import "./globals.css";

// サイト名・URL・運営者名は環境変数(NEXT_PUBLIC_SITE_URL、REPORT_BRAND_NAME)から。ビルド時に決まる
const operator = operatorName();
const siteName = operator ?? SERVICE_NAME;
const indexable = isIndexable();

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: {
    default: operator ? `無料の${SERVICE_NAME}|${operator}` : `無料の${SERVICE_NAME}`,
    template: `%s|${siteName}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SERVICE_NAME,
  ...(operator && { authors: [{ name: operator }], publisher: operator }),
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "ja_JP",
    url: "/",
    siteName,
    title: OG_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: OG_TITLE,
    description: SITE_DESCRIPTION,
  },
  robots: indexable ? { index: true, follow: true } : { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9f9f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0d0d" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        {children}
        <AnalyticsScripts />
      </body>
    </html>
  );
}
