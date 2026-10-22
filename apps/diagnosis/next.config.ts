import path from "node:path";
import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security-headers";

// 共通の部品(リポジトリ直下の packages/shared。tsconfig の "@idea/shared/*")を TypeScript のソースのまま取り込むため、
// Turbopack のルートとファイルトレースのルートをリポジトリのルートにする(ルートの外のファイルは解決されない)。
// Vercel ではルートディレクトリを apps/diagnosis にしたまま、ルートディレクトリの外のファイルもビルドに含める設定にする。
// next.config.ts は CommonJS に変換して読み込まれるので __dirname が使える。
const repoRoot = path.join(__dirname, "../..");

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  outputFileTracingRoot: repoRoot,
  // PDFとOGP画像の日本語フォントは実行時にファイルから読むので、サーバーの成果物に含める
  outputFileTracingIncludes: {
    "/api/report": ["./assets/fonts/*.ttf"],
    "/opengraph-image": ["./assets/fonts/*.ttf"],
    "/twitter-image": ["./assets/fonts/*.ttf"],
  },
  // CSPで許可する外部の送信先は、ビルド時の設定(Turnstile・計測)に合わせる
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders({
          isDev: process.env.NODE_ENV === "development",
          turnstile: Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim()),
          analytics: process.env.NEXT_PUBLIC_ANALYTICS_PROVIDER?.trim().toLowerCase(),
        }),
      },
    ];
  },
  turbopack: {
    root: repoRoot,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
