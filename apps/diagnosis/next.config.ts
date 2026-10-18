import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // PDFの日本語フォントは実行時にファイルから読むので、サーバーの成果物に含める
  outputFileTracingIncludes: {
    "/api/report": ["./assets/fonts/*.ttf"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
