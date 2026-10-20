// 画面・PDF・メタデータで使う、環境変数による設定。
// NEXT_PUBLIC_ の値と、メタデータ・OGP画像・robots・sitemap に使う値はビルド時に決まるので、変えたらビルドし直す。

/** サービス名。タイトルやOGP画像に使う */
export const SERVICE_NAME = "AI導入診断";

export const SITE_DESCRIPTION =
  "業務時間とIT環境を入力するだけで、AIで削減できる業務・削減額・3ヶ月のロードマップがわかる無料診断です。";

/** SNSで共有されたときの見出し */
export const OG_TITLE = "御社の業務、AIでどれだけ減らせるか。|無料のAI導入診断";

/** http(s) のURLだけを使う(javascript: などをリンクにしない) */
export function httpUrlOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && /^https?:\/\/\S+$/i.test(trimmed) ? trimmed : undefined;
}

/** 外部の問い合わせ窓口。PDFの申し込み先や、フォームを送れなかったときの案内に使う */
export const CONTACT_URL = httpUrlOrUndefined(process.env.NEXT_PUBLIC_CONTACT_URL);

/** プライバシーポリシーのページ。申し込みフォームの同意欄からリンクする */
export const PRIVACY_POLICY_URL = httpUrlOrUndefined(process.env.NEXT_PUBLIC_PRIVACY_POLICY_URL);

/**
 * 公開URL(OGP・canonical・robots・sitemap の絶対URL)。
 * NEXT_PUBLIC_SITE_URL → Vercel の本番ドメイン(VERCEL_PROJECT_PRODUCTION_URL)→ localhost の順に使う。
 */
export function siteUrl(env: NodeJS.ProcessEnv = process.env): URL {
  const configured = httpUrlOrUndefined(env.NEXT_PUBLIC_SITE_URL);
  if (configured) return new URL(configured);
  const vercelDomain = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelDomain) return new URL(`https://${vercelDomain}`);
  return new URL(`http://localhost:${env.PORT || 3000}`);
}

/** 運営者名(REPORT_BRAND_NAME を流用)。未設定なら undefined */
export function operatorName(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.REPORT_BRAND_NAME?.trim() || undefined;
}

/** PDFのヘッダー・フッターに出す発行元の名前(サーバーで実行時に読む) */
export function reportBrandName(env: NodeJS.ProcessEnv = process.env): string {
  return operatorName(env) ?? SERVICE_NAME;
}

/** 検索エンジンに載せるか。Vercel のプレビュー環境(VERCEL_ENV=preview)では載せない */
export function isIndexable(env: NodeJS.ProcessEnv = process.env): boolean {
  return !env.VERCEL_ENV || env.VERCEL_ENV === "production";
}
