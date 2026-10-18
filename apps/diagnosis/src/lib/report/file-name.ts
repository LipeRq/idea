/** ダウンロードするPDFのファイル名。例:AI導入診断レポート_テスト工業_20261018.pdf */
export function reportFileName(issuedAt: Date, companyName?: string): string {
  const date = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(issuedAt)
    .replaceAll("/", "");
  // ファイル名に使えない文字と制御文字を除き、長すぎる会社名は切る
  const company = Array.from(companyName ?? "")
    .filter((c) => c > "\x1f" && c !== "\x7f" && !'\\/:*?"<>|'.includes(c))
    .slice(0, 40)
    .join("")
    .trim();
  return ["AI導入診断レポート", company, date].filter(Boolean).join("_") + ".pdf";
}

/** Content-Disposition の filename* からファイル名を取り出す(取り出せなければ null) */
export function fileNameFromDisposition(header: string | null): string | null {
  const match = header?.match(/filename\*=UTF-8''([^;]+)/i);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}
