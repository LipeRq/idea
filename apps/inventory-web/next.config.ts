import path from "node:path";
import type { NextConfig } from "next";
import { securityHeaders, WORKER_SCRIPT_CSP } from "./src/lib/security-headers";

// サーバーの AI ルートが解析エンジン(../inventory/src)を import し、その依存(@anthropic-ai/sdk・zod)を
// apps/inventory/node_modules から解決する。また共通の部品(リポジトリ直下の packages/shared。tsconfig の "@idea/shared/*")を
// TypeScript のソースのまま取り込む。両方を含むよう、Turbopack のルートとファイルトレースのルートをリポジトリのルートにする
// (ルートの外のファイルは解決されない。リポジトリ直下には apps/・packages/・docs/ しかないので、監視は重くならない)。
// (画面側はエンジンを型としてだけ参照するので、ブラウザのバンドルにエンジンは入らない。Worker は esbuild で別に作る)
// next.config.ts は CommonJS に変換して読み込まれるので __dirname が使える。
const repoRoot = path.join(__dirname, "../..");

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  turbopack: {
    root: repoRoot,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  outputFileTracingRoot: repoRoot,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders({ isDev: process.env.NODE_ENV === "development" }),
      },
      {
        // 解析 Worker のスクリプト。ファイル名に内容のハッシュが入っているので、ずっとキャッシュしてよい(オフラインでも作り直せる)。
        // CSP は上の全体のものを上書きし、Worker の中では一切の通信・スクリプトの読み込み・Worker の作成を禁止する
        // (同じキーのヘッダーは後に書いたものが優先される)
        source: "/engine/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "Content-Security-Policy", value: WORKER_SCRIPT_CSP },
        ],
      },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
