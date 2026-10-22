import {
  contentSecurityPolicy as buildContentSecurityPolicy,
  securityHeaders as buildSecurityHeaders,
  type Header,
} from "../../../../packages/shared/src/security-headers";
// ↑ next.config.ts から読み込まれるファイルなので、別名(@idea/shared)ではなく相対パスにする
//   (next.config.ts の読み込みでは、src/ の下のファイルの別名がアプリのルートからの相対パスに書き換わり、解決できない)

// すべての応答に付けるセキュリティヘッダー(next.config.ts の headers() から使う)。
// 共通の部分は packages/shared の security-headers.ts。このアプリは、ビルド時の設定に合わせて
// Cloudflare Turnstile と計測(GA4・Vercel Web Analytics)の送信先を CSP に足す。

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

// このアプリだけの値(ほかのアプリは参照元を送らない no-referrer、支払い・USB も止める)
const REFERRER_POLICY = "strict-origin-when-cross-origin";
const PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=()";

export function contentSecurityPolicy({ isDev, turnstile, analytics }: SecurityHeaderOptions): string {
  const script: string[] = [];
  const connect: string[] = [];
  const img: string[] = [];
  const frame: string[] = [];

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

  return buildContentSecurityPolicy({ isDev, scriptSrc: script, connectSrc: connect, imgSrc: img, frameSrc: frame });
}

export function securityHeaders(options: SecurityHeaderOptions): Header[] {
  return buildSecurityHeaders({
    csp: contentSecurityPolicy(options),
    referrerPolicy: REFERRER_POLICY,
    permissionsPolicy: PERMISSIONS_POLICY,
  });
}
