import path from "node:path";
import type { NextConfig } from "next";
// next.config.ts の読み込みでは別名(@idea/shared)が確実には解決されないので、相対パスにする
import { contentSecurityPolicy, securityHeaders } from "../../packages/shared/src/security-headers";

// 共通の部品(リポジトリ直下の packages/shared。tsconfig の "@idea/shared/*")を TypeScript のソースのまま取り込むため、
// Turbopack のルートとファイルトレースのルートをリポジトリのルートにする(ルートの外のファイルは解決されない)。
// Vercel ではルートディレクトリを apps/quote-assist にしたまま、ルートディレクトリの外のファイルもビルドに含める設定にする。
// next.config.ts は CommonJS に変換して読み込まれるので __dirname が使える。
const repoRoot = path.join(__dirname, "../..");

// セキュリティヘッダーは共通の既定のまま(外部のオリジンは1つも許可しない・参照元を送らない)。
// 図面PDFの表示(/api/inquiries/:id/drawings/:drawingId。Content-Disposition: inline)はブラウザの PDF ビューアーで開くため、
// CSP はページだけに付け、/api/ には CSP 以外のヘッダーだけを付ける。

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  outputFileTracingRoot: repoRoot,
  turbopack: {
    root: repoRoot,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders() },
      {
        // ページの CSP。/api/ は除く(図面PDFをブラウザの PDF ビューアーでそのまま表示するため)
        source: "/:path((?!api/).*)",
        headers: [{ key: "Content-Security-Policy", value: contentSecurityPolicy({ isDev: process.env.NODE_ENV === "development" }) }],
      },
    ];
  },
};

export default nextConfig;
