// サイトの名前と、ビルド時に決まる外部へのリンク(NEXT_PUBLIC_* はビルド時に埋め込まれる)。
// 外部へのリンクは相談ページとプライバシーポリシーだけ(どちらも解析結果を一切付けない・新しいタブで開く)。

export const SERVICE_NAME = "マクロ棚卸し";
export const SITE_DESCRIPTION =
  "作った人が辞めて中身が分からない Excel マクロ・Access ファイルを、ブラウザの中だけで解析して、仕様書・処理の流れ・リスク・移行の目安を作ります。ファイルはサーバーに送信しません。";

function httpUrl(value: string | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  try {
    const url = new URL(v);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function contactUrl(): string | null {
  return httpUrl(process.env.NEXT_PUBLIC_CONTACT_URL);
}

export function privacyPolicyUrl(): string | null {
  return httpUrl(process.env.NEXT_PUBLIC_PRIVACY_POLICY_URL);
}
