import { defineConfig, devices } from "@playwright/test";

// 開発用サーバー(3000)や手元で動かしている next start(3100)とぶつからないポート
const PORT = Number(process.env.E2E_PORT ?? 3200);

export default defineConfig({
  testDir: "./e2e",
  // 診断APIは同じ送信元から1時間に5回までなので、並列にせず順番に流す
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
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // 本番ビルドで確認する。毎回起動し直すので、回数制限のカウントも0から始まる
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: "ignore",
    stderr: "pipe",
    // APIキーがあっても実際のAIは呼ばず、決まった標準レポートで確認する
    env: { ANTHROPIC_API_KEY: "", ANTHROPIC_AUTH_TOKEN: "" },
  },
});
