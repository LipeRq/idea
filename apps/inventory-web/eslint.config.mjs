import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// 通信に使える API。ブラウザで動くコードでは、決めた2ファイル(サンプルの取得・同意後の AI 送信)
// 以外で使うとエラーにする(docs/design.md §4.1「通信を書ける場所を限定」)
const NETWORK_GLOBALS = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "WebTransport", "importScripts"].map((name) => ({
  name,
  message: "ブラウザ側で通信できるのは src/lib/samples.ts・src/lib/ai-client.ts だけです(docs/design.md §4.1)",
}));
const NETWORK_PROPERTIES = [
  { object: "navigator", property: "sendBeacon", message: "通信はできません(docs/design.md §4.1)" },
  { object: "window", property: "fetch", message: "通信はできません(docs/design.md §4.1)" },
  { object: "globalThis", property: "fetch", message: "通信はできません(docs/design.md §4.1)" },
  { object: "self", property: "fetch", message: "通信はできません(docs/design.md §4.1)" },
];

// 画面(メインスレッド)のコード。エンジンは型としてだけ参照し、実行コードは Worker のバンドルにだけ入れる。
// 外部に何かを送る計測・エラー監視のライブラリは入れない
const CLIENT_RESTRICTED_IMPORTS = {
  paths: [
    { name: "@/worker/handle", message: "画面から Worker の処理を直接呼ばないでください(Worker に依頼する)", allowTypeImports: true },
    { name: "@/worker/markdown", message: "画面から Worker の処理を直接呼ばないでください", allowTypeImports: true },
    { name: "@/shared/ai-estimate", message: "エンジンの実行コードを画面のバンドルに入れないでください", allowTypeImports: true },
    { name: "@vercel/analytics", message: "計測タグは入れません(docs/design.md §4.1)" },
    { name: "@vercel/speed-insights", message: "計測タグは入れません(docs/design.md §4.1)" },
  ],
  patterns: [
    { group: ["@engine/*"], message: "画面からはエンジンを型としてだけ参照してください(import type)", allowTypeImports: true },
    { group: ["@/lib/server/*"], message: "サーバー専用のモジュールです" },
    // 共通の部品(packages/shared)は、セキュリティヘッダー(next.config.ts から使う)以外はサーバー専用
    { group: ["@idea/shared/*", "!@idea/shared/security-headers"], message: "サーバー専用のモジュールです(src/lib/server・API で使ってください)" },
    { group: ["@sentry/*", "@datadog/*", "@vercel/toolbar", "posthog-*", "@google-analytics/*"], message: "外部に送信するライブラリは入れません(docs/design.md §4.1)" },
  ],
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 生成物(scripts/prepare.mjs が作る)
    "public/engine/**",
    "public/samples/**",
    "src/generated/**",
    "e2e/.fixtures/**",
    "test-results/**",
    "playwright-report/**",
  ]),
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/app/api/**",
      "src/lib/server/**",
      "src/lib/samples.ts",
      "src/lib/ai-client.ts",
      "src/**/*.test.ts",
    ],
    rules: {
      "no-restricted-globals": ["error", ...NETWORK_GLOBALS],
      "no-restricted-properties": ["error", ...NETWORK_PROPERTIES],
    },
  },
  {
    files: ["src/components/**/*.{ts,tsx}", "src/app/**/*.{ts,tsx}", "src/lib/**/*.{ts,tsx}"],
    ignores: ["src/app/api/**", "src/lib/server/**", "src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", CLIENT_RESTRICTED_IMPORTS],
    },
  },
]);

export default eslintConfig;
