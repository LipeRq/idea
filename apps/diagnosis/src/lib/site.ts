// 画面とPDFで使う、環境変数による設定。
// NEXT_PUBLIC_ の値はビルド時に埋め込まれるので、変えたらビルドし直す。

/** http(s) のURLだけを使う(javascript: などをリンクにしない) */
export function httpUrlOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && /^https?:\/\/\S+$/i.test(trimmed) ? trimmed : undefined;
}

/** 外部の問い合わせ窓口。PDFの申し込み先や、フォームを送れなかったときの案内に使う */
export const CONTACT_URL = httpUrlOrUndefined(process.env.NEXT_PUBLIC_CONTACT_URL);

/** プライバシーポリシーのページ。申し込みフォームの同意欄からリンクする */
export const PRIVACY_POLICY_URL = httpUrlOrUndefined(process.env.NEXT_PUBLIC_PRIVACY_POLICY_URL);

/** PDFのヘッダー・フッターに出す発行元の名前(サーバーで実行時に読む) */
export function reportBrandName(): string {
  return process.env.REPORT_BRAND_NAME?.trim() || "AI導入診断";
}
