// すべての応答に付けるセキュリティヘッダー(next.config.ts の headers() から使う)。
// apps/diagnosis と同じく、ページは静的に生成する(Cache Components)ので nonce ではなく固定の CSP を付ける。
// Next.js がページに埋め込むインラインのスクリプトのため、script-src に 'unsafe-inline' が必要。
// 外部のオリジンは1つも許可しない。connect-src 'self' なので、fetch などによる第三者のサーバーへの通信はブラウザが止める
// (画面遷移やリンクは CSP では止まらないため、外部へのリンクは相談ページとプライバシーポリシーだけにしている)。
// 解析 Worker のスクリプト(/engine/*)には、通信・スクリプトの読み込み・Worker の作成をすべて禁止する別の CSP を付ける
// (workerScriptCsp。Worker はスクリプトの応答の CSP に従うので、解析プログラムからはブラウザの機能として一切通信できない)。

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
    // React の style 属性と、mermaid の SVG の中の <style> のため
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * 解析 Worker のスクリプトの CSP。Worker の中では、同一オリジンを含めて一切の通信(fetch・XMLHttpRequest・WebSocket・
 * EventSource・Cache API の add)、スクリプトの読み込み(importScripts・import())、Worker の作成、eval を禁止する。
 */
export const WORKER_SCRIPT_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "connect-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

export function securityHeaders(options: SecurityHeaderOptions): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(options) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    // HTTPS で配信したときだけブラウザが従う(localhost の http では無視される)
    { key: "Strict-Transport-Security", value: "max-age=63072000" },
  ];
}
