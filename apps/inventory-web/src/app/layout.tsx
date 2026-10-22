import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { ExternalLink } from "@/components/ExternalLink";
import { engineAsset } from "@/lib/generated";
import { contactUrl, operatorName, privacyPolicyUrl, SERVICE_NAME, SITE_DESCRIPTION, termsUrl } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: `${SERVICE_NAME}|Excel マクロ・Access の中身を見える化`, template: `%s|${SERVICE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SERVICE_NAME,
  referrer: "no-referrer",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9f9f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0d0d" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const contact = contactUrl();
  const privacy = privacyPolicyUrl();
  const terms = termsUrl();
  const operator = operatorName();
  const { engineVersion } = engineAsset();
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <header className="no-print border-b border-line bg-surface">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
            <Link href="/" className="text-lg font-bold">
              {SERVICE_NAME}
            </Link>
            <Link href="/how-it-works" className="text-sm text-accent-ink underline underline-offset-2">
              仕組みとデータの扱い
            </Link>
          </div>
        </header>
        <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">{children}</div>
        <footer className="no-print mx-auto flex w-full max-w-6xl flex-wrap gap-x-4 gap-y-1 px-4 pb-8 text-xs text-muted">
          {operator && <span>運営:{operator}</span>}
          <span>解析エンジン ai-inventory {engineVersion}</span>
          {contact && <ExternalLink href={contact}>移行・改修の相談</ExternalLink>}
          {terms && <ExternalLink href={terms}>利用規約</ExternalLink>}
          {privacy && <ExternalLink href={privacy}>プライバシーポリシー</ExternalLink>}
        </footer>
      </body>
    </html>
  );
}
