// すべての応答に付けるセキュリティヘッダー(各アプリの next.config.ts の headers() から使う)。
// ページは静的に生成する(Cache Components)ので、nonce ではなく固定の CSP を付ける。
// Next.js がページに埋め込むインラインのスクリプトのため、script-src に 'unsafe-inline' が必要。
// 既定では外部のオリジンを1つも許可しない。アプリごとに必要な送信先(Turnstile・計測など)だけを引数で足す。

export type Header = { key: string; value: string };

export type ContentSecurityPolicyOptions = {
  /** next dev(React が eval を使う) */
  isDev: boolean;
  /** script-src に足す送信元('self' 'unsafe-inline'(next dev では 'unsafe-eval')の後に、この順で並べる) */
  scriptSrc?: readonly string[];
  /** connect-src に足す送信元('self' の後) */
  connectSrc?: readonly string[];
  /** img-src に足す送信元('self' data: blob: の後) */
  imgSrc?: readonly string[];
  /** frame-src に許可する送信元。無ければ 'none' */
  frameSrc?: readonly string[];
  /** worker-src。指定したときだけ出す(指定が無ければ default-src 'self' に従う) */
  workerSrc?: readonly string[];
};

export function contentSecurityPolicy(options: ContentSecurityPolicyOptions): string {
  const script = ["'self'", "'unsafe-inline'"];
  if (options.isDev) script.push("'unsafe-eval'");
  script.push(...(options.scriptSrc ?? []));
  const frame = options.frameSrc ?? [];

  return [
    "default-src 'self'",
    `script-src ${script.join(" ")}`,
    // React の style 属性(グラフの幅など)・Turnstile・mermaid の SVG の中の <style> のため
    "style-src 'self' 'unsafe-inline'",
    `img-src ${["'self'", "data:", "blob:", ...(options.imgSrc ?? [])].join(" ")}`,
    "font-src 'self'",
    `connect-src ${["'self'", ...(options.connectSrc ?? [])].join(" ")}`,
    ...(options.workerSrc ? [`worker-src ${options.workerSrc.join(" ")}`] : []),
    `frame-src ${frame.length > 0 ? frame.join(" ") : "'none'"}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** 参照元を一切送らない(既定) */
export const DEFAULT_REFERRER_POLICY = "no-referrer";
/** 使わない機能を止める(既定) */
export const DEFAULT_PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=(), usb=()";

export type SecurityHeaderOptions = {
  /** Content-Security-Policy の値。省略すると CSP は付けない(ページだけに別の規則で付けるアプリ向け) */
  csp?: string;
  /** 既定は DEFAULT_REFERRER_POLICY */
  referrerPolicy?: string;
  /** 既定は DEFAULT_PERMISSIONS_POLICY */
  permissionsPolicy?: string;
};

export function securityHeaders(options: SecurityHeaderOptions = {}): Header[] {
  return [
    ...(options.csp !== undefined ? [{ key: "Content-Security-Policy", value: options.csp }] : []),
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: options.referrerPolicy ?? DEFAULT_REFERRER_POLICY },
    { key: "Permissions-Policy", value: options.permissionsPolicy ?? DEFAULT_PERMISSIONS_POLICY },
    // 別のオリジンから window.open されたときに、開いた側からこのページを操作させない
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    // HTTPS で配信したときだけブラウザが従う(localhost の http では無視される)
    { key: "Strict-Transport-Security", value: "max-age=63072000" },
  ];
}
