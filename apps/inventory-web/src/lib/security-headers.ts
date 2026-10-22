import {
  contentSecurityPolicy as buildContentSecurityPolicy,
  securityHeaders as buildSecurityHeaders,
  type Header,
} from "../../../../packages/shared/src/security-headers";
// ↑ next.config.ts から読み込まれるファイルなので、別名(@idea/shared)ではなく相対パスにする
//   (next.config.ts の読み込みでは、src/ の下のファイルの別名がアプリのルートからの相対パスに書き換わり、解決できない)

// すべての応答に付けるセキュリティヘッダー(next.config.ts の headers() から使う。共通の部分は packages/shared)。
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
  // 共通の CSP(packages/shared の security-headers.ts)に、解析 Worker(同じオリジンのスクリプト)の許可だけを足す
  return buildContentSecurityPolicy({ isDev, workerSrc: ["'self'"] });
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

export function securityHeaders(options: SecurityHeaderOptions): Header[] {
  // 参照元を送らない(no-referrer)・支払いや USB も止める、は共通の既定のまま
  return buildSecurityHeaders({ csp: contentSecurityPolicy(options) });
}
