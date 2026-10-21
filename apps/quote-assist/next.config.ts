import type { NextConfig } from "next";
import { contentSecurityPolicy, securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  turbopack: {
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
