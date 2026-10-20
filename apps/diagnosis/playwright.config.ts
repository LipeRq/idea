import { defineConfig, devices } from "@playwright/test";
import { E2E_SITE_URL } from "./e2e/constants";

// 開発用サーバー(3000)や手元で動かしている next start(3100)とぶつからないポート
const PORT = Number(process.env.E2E_PORT ?? 3200);
// 同じビルドを、AIの1日の上限に達する設定でもう1台起動する(e2e/cost-guard.spec.ts)
const COST_GUARD_PORT = PORT + 1;

// 外部のサービスには接続しない。手元の .env.local やシェルの設定に左右されないよう、関係する値を空にする
const isolatedEnv = {
  // APIキーがあっても実際のAIは呼ばず、決まった標準レポートで確認する
  ANTHROPIC_API_KEY: "",
  ANTHROPIC_AUTH_TOKEN: "",
  ANTHROPIC_BASE_URL: "",
  AI_DAILY_LIMIT: "",
  // 回数制限でテストの本数が縛られないよう、上限を緩める(制限そのものは単体テストで確認)
  RATE_LIMIT_DIAGNOSE_PER_HOUR: "1000",
  RATE_LIMIT_REPORT_PER_HOUR: "1000",
  RATE_LIMIT_LEAD_PER_HOUR: "1000",
  // 回数はインスタンス内のメモリで数える
  UPSTASH_REDIS_REST_URL: "",
  UPSTASH_REDIS_REST_TOKEN: "",
  KV_REST_API_URL: "",
  KV_REST_API_TOKEN: "",
  // ボット対策(Turnstile)は無効。無効でも今のフローが動くことを確かめる
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "",
  TURNSTILE_SECRET_KEY: "",
  // 申し込みは外部に送らず、個人情報を伏せたサーバーログに出すだけにする
  SALESFORCE_ORG_ID: "",
  LEAD_WEBHOOK_URL: "",
  LEAD_LOG_ONLY: "true",
  // 本番以外でも検索エンジン向けの設定を本番と同じにする
  VERCEL_ENV: "",
};

export default defineConfig({
  testDir: "./e2e",
  // サーバーを使い回すので、並列にせず順番に流す
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    locale: "ja-JP",
    trace: "retain-on-failure",
    // ロケールが未設定(C)の環境では、Chromium が日本語のファイル名でダウンロードを保存できず
    // 「download」という名前になる。利用者の環境(UTF-8)に合わせる
    launchOptions: { env: { ...process.env, LANG: process.env.LANG || "C.UTF-8" } },
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /cost-guard\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${PORT}` },
    },
    {
      name: "cost-guard",
      testMatch: /cost-guard\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${COST_GUARD_PORT}` },
    },
  ],
  // 1台目がビルドしてから起動し、2台目は同じビルドを別の設定で起動する(Playwright は順番に起動する)
  webServer: [
    {
      // 本番ビルドで確認する
      command: `npm run build && npm run start -- -p ${PORT}`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: false,
      timeout: 300_000,
      stdout: "ignore",
      stderr: "pipe",
      env: {
        ...isolatedEnv,
        // ビルド時に埋め込まれる値。同意欄のリンク・PDF・メタデータを手元の設定に左右されないようにする
        NEXT_PUBLIC_PRIVACY_POLICY_URL: "https://example.com/privacy",
        NEXT_PUBLIC_CONTACT_URL: "",
        NEXT_PUBLIC_SITE_URL: E2E_SITE_URL,
        REPORT_BRAND_NAME: "",
        // 計測はページの変数に記録するだけ(外部に送らない)。送る内容に個人情報がないことを確かめる
        NEXT_PUBLIC_ANALYTICS_PROVIDER: "debug",
        NEXT_PUBLIC_GA_MEASUREMENT_ID: "",
      },
    },
    {
      command: `npm run start -- -p ${COST_GUARD_PORT}`,
      url: `http://localhost:${COST_GUARD_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
      env: {
        ...isolatedEnv,
        REPORT_BRAND_NAME: "",
        // AIを使う設定にするが、送信先は fetch が接続を拒む手元のポート(9番)にする(外部に接続しない・費用はかからない)
        ANTHROPIC_API_KEY: "sk-ant-e2e-dummy",
        ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
        AI_DAILY_LIMIT: "1",
      },
    },
  ],
});
