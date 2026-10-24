import path from "node:path";
import type { NextConfig } from "next";

// 共通の部品(リポジトリ直下の packages/shared)を TypeScript のソースのまま相対パスで取り込むので、
// Turbopack のルートとファイルトレースのルートをリポジトリのルートにする(ルートの外のファイルは解決されない)。
// next.config.ts は CommonJS に変換して読み込まれるので __dirname が使える。
const repoRoot = path.join(__dirname, "../..");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: {
    root: repoRoot,
  },
  outputFileTracingRoot: repoRoot,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
