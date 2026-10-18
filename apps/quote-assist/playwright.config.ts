import { defineConfig, devices } from "@playwright/test";

// 他のアプリのE2E(3200)や開発サーバー(3000)とぶつからないポート
const PORT = Number(process.env.E2E_PORT ?? 3310);
// E2E専用の保存先。起動のたびに空にする
const DATA_DIR = ".data-e2e";

export default defineConfig({
  testDir: "./e2e",
  // 保存データを共有するので、並列にせず順番に流す
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"]],
  timeout: 90_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `node -e "require('fs').rmSync('${DATA_DIR}',{recursive:true,force:true})" && npm run build && npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: "ignore",
    stderr: "pipe",
    // APIキーがあっても実際のAIは呼ばず、デモモード(合成データの固定結果)とモックのSalesforceで確認する
    env: {
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_AUTH_TOKEN: "",
      AI_PROVIDER: "demo",
      CRM_PROVIDER: "mock",
      STORAGE_DRIVER: "file",
      QUOTE_ASSIST_DATA_DIR: DATA_DIR,
    },
  },
});
