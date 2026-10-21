// すべての応答に付けるセキュリティヘッダー(next.config.ts の headers() から使う)。
// ページは静的に生成する(Cache Components)ので、nonce ではなく next.config.ts で固定のCSPを付ける。
// Next.js がページに埋め込むインラインのスクリプトのため、script-src に 'unsafe-inline' が必要。

export type SecurityHeaderOptions = {
  /** next dev(React が eval を使う) */
  isDev: boolean;
  /** Cloudflare Turnstile のウィジェットを使う */
  turnstile: boolean;
  /** 計測のプロバイダー(NEXT_PUBLIC_ANALYTICS_PROVIDER) */
  analytics?: string;
};

const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
// Google タグ(GA4)が使う送信先(Google のCSPの案内に合わせる)
const GA_SCRIPT = ["https://*.googletagmanager.com"];
const GA_CONNECT = [
  "https://*.google-analytics.com",
  "https://*.analytics.google.com",
  "https://*.googletagmanager.com",
];
const GA_IMG = ["https://*.google-analytics.com", "https://*.googletagmanager.com"];
// Vercel Web Analytics は本番では同じオリジン(/_vercel/insights)、next dev ではこのスクリプトを読む
const VERCEL_ANALYTICS_DEV_SCRIPT = "https://va.vercel-scripts.com";

export function contentSecurityPolicy({ isDev, turnstile, analytics }: SecurityHeaderOptions): string {
  const script = ["'self'", "'unsafe-inline'"];
  const connect = ["'self'"];
  const img = ["'self'", "data:", "blob:"];
  const frame: string[] = [];

  if (isDev) script.push("'unsafe-eval'");
  if (turnstile) {
    script.push(TURNSTILE_ORIGIN);
    frame.push(TURNSTILE_ORIGIN);
  }
  if (analytics === "ga4") {
    script.push(...GA_SCRIPT);
    connect.push(...GA_CONNECT);
    img.push(...GA_IMG);
  }
  if (analytics === "vercel" && isDev) script.push(VERCEL_ANALYTICS_DEV_SCRIPT);

  return [
    "default-src 'self'",
    `script-src ${script.join(" ")}`,
    // React の style 属性(グラフの幅など)と Turnstile のため
    "style-src 'self' 'unsafe-inline'",
    `img-src ${img.join(" ")}`,
    "font-src 'self'",
    `connect-src ${connect.join(" ")}`,
    `frame-src ${frame.length > 0 ? frame.join(" ") : "'none'"}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function securityHeaders(options: SecurityHeaderOptions): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(options) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    // 別のオリジンから window.open されたときに、開いた側からこのページを操作させない
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    // HTTPS で配信したときだけブラウザが従う(localhost の http では無視される)
    { key: "Strict-Transport-Security", value: "max-age=63072000" },
  ];
}
