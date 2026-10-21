// すべての応答に付けるセキュリティヘッダー(next.config.ts の headers() から使う)。apps/inventory-web と同じ方針。
// Next.js がページに埋め込むインラインのスクリプトのため、script-src に 'unsafe-inline' が必要。外部のオリジンは1つも許可しない。
// 図面PDFの表示(/api/inquiries/:id/drawings/:drawingId。Content-Disposition: inline)はブラウザの PDF ビューアーで開くため、
// ページ用の CSP は付けない(next.config.ts で /api/ を除いている)。

export type SecurityHeaderOptions = {
  /** next dev(React が eval を使う) */
  isDev: boolean;
};

export function contentSecurityPolicy({ isDev }: SecurityHeaderOptions): string {
  const script = ["'self'", "'unsafe-inline'"];
  if (isDev) script.push("'unsafe-eval'");
  return [
    "default-src 'self'",
    `script-src ${script.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** CSP 以外のヘッダー(API・図面PDFを含むすべての応答に付ける) */
export function securityHeaders(): { key: string; value: string }[] {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    // HTTPS で配信したときだけブラウザが従う(localhost の http では無視される)
    { key: "Strict-Transport-Security", value: "max-age=63072000" },
  ];
}
