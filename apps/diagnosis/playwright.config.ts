import { defineConfig, devices } from "@playwright/test";

// 開発用サーバー(3000)や手元で動かしている next start(3100)とぶつからないポート
const PORT = Number(process.env.E2E_PORT ?? 3200);

export default defineConfig({
  testDir: "./e2e",
  // サーバーを1つだけ起動して使い回すので、並列にせず順番に流す
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "ja-JP",
    trace: "retain-on-failure",
    // ロケールが未設定(C)の環境では、Chromium が日本語のファイル名でダウンロードを保存できず
    // 「download」という名前になる。利用者の環境(UTF-8)に合わせる
    launchOptions: { env: { ...process.env, LANG: process.env.LANG || "C.UTF-8" } },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // 本番ビルドで確認する
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      // APIキーがあっても実際のAIは呼ばず、決まった標準レポートで確認する
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_AUTH_TOKEN: "",
      // 回数制限でテストの本数が縛られないよう、上限を緩める(制限そのものは単体テストで確認)
      RATE_LIMIT_DIAGNOSE_PER_HOUR: "1000",
      RATE_LIMIT_REPORT_PER_HOUR: "1000",
      RATE_LIMIT_LEAD_PER_HOUR: "1000",
      // 申し込みは外部に送らず、個人情報を伏せたサーバーログに出すだけにする
      SALESFORCE_ORG_ID: "",
      LEAD_WEBHOOK_URL: "",
      LEAD_LOG_ONLY: "true",
      // ビルド時に埋め込まれる値。同意欄のリンクとPDFの内容を手元の設定に左右されないようにする
      NEXT_PUBLIC_PRIVACY_POLICY_URL: "https://example.com/privacy",
      NEXT_PUBLIC_CONTACT_URL: "",
      REPORT_BRAND_NAME: "",
    },
  },
});
