import { defineConfig, devices } from "@playwright/test";

// 同じ本番ビルドを、環境変数だけを変えて3台起動する(docs/design.md §7.2)。
//   3410: 既定(AI 版は無効)  3411: AI 版をモックで有効(アクセスコードあり)  3412: claude モード(接続できない宛先・1日1回)
// NEXT_PUBLIC_* はビルド時に埋め込まれるため3台で同じ値になる(相談・プライバシーポリシーのリンクはビルド時の値)。
const BASE_PORT = Number(process.env.E2E_PORT ?? 3410);
const PORTS = { off: BASE_PORT, mock: BASE_PORT + 1, claude: BASE_PORT + 2 };

// 外部のサービスには接続しない。手元の .env.local やシェルの設定に左右されないよう、関係する値を空にする
const isolatedEnv = {
  ANTHROPIC_API_KEY: "",
  ANTHROPIC_AUTH_TOKEN: "",
  ANTHROPIC_BASE_URL: "",
  INVENTORY_AI_MODE: "off",
  INVENTORY_AI_ACCESS_CODE: "",
  INVENTORY_AI_ALLOW_ANONYMOUS: "",
  INVENTORY_AI_DAILY_LIMIT: "",
  INVENTORY_AI_DAILY_INPUT_TOKENS: "",
  INVENTORY_AI_PER_HOUR: "",
  INVENTORY_AI_MAX_INPUT_TOKENS: "",
  INVENTORY_AI_MAX_BATCHES: "",
  INVENTORY_AI_MAX_BODY_BYTES: "",
  INVENTORY_AI_REQUIRE_SHARED_STORE: "",
  INVENTORY_SAMPLES_DIR: "",
  UPSTASH_REDIS_REST_URL: "",
  UPSTASH_REDIS_REST_TOKEN: "",
  KV_REST_API_URL: "",
  KV_REST_API_TOKEN: "",
  VERCEL: "",
};

// サーバーの標準出力・標準エラーをファイルに残し、ファイル由来の文字列がログに出ていないことを確かめる(e2e/ai.spec.ts)
const logTo = (name: string) => `mkdir -p e2e/.logs && npx next start -p ${PORTS[name as keyof typeof PORTS]} > e2e/.logs/${name}.log 2>&1`;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  // サーバーを使い回すので、並列にせず順番に流す
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"]],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    ...devices["Desktop Chrome"],
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    acceptDownloads: true,
    trace: "retain-on-failure",
    // ロケールが未設定(C)の環境では、Chromium が日本語のファイル名でダウンロードを保存できないため
    launchOptions: { env: { ...process.env, LANG: process.env.LANG || "C.UTF-8" } },
  },
  projects: [
    {
      name: "ai-off",
      testIgnore: /ai-(mock|claude)\.spec\.ts/,
      use: { baseURL: `http://localhost:${PORTS.off}` },
    },
    {
      name: "ai-mock",
      testMatch: /ai-mock\.spec\.ts/,
      use: { baseURL: `http://localhost:${PORTS.mock}` },
    },
    {
      name: "ai-claude",
      testMatch: /ai-claude\.spec\.ts/,
      use: { baseURL: `http://localhost:${PORTS.claude}` },
    },
  ],
  // 1台目がビルドしてから起動し、2台目・3台目は同じビルドを別の設定で起動する(Playwright は順番に起動する)
  webServer: [
    {
      command: `npm run build && ${logTo("off")}`,
      url: `http://localhost:${PORTS.off}`,
      reuseExistingServer: false,
      timeout: 400_000,
      stdout: "ignore",
      stderr: "pipe",
      env: {
        ...isolatedEnv,
        NEXT_PUBLIC_CONTACT_URL: "https://example.com/contact",
        NEXT_PUBLIC_PRIVACY_POLICY_URL: "https://example.com/privacy",
      },
    },
    {
      command: logTo("mock"),
      url: `http://localhost:${PORTS.mock}`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
      env: {
        ...isolatedEnv,
        INVENTORY_AI_MODE: "mock",
        INVENTORY_AI_ACCESS_CODE: "e2e-code",
        INVENTORY_AI_PER_HOUR: "1000",
        INVENTORY_AI_DAILY_LIMIT: "1000",
        // 生成中の「中止」を確かめられるよう、1回の依頼に時間をかける
        INVENTORY_AI_MOCK_DELAY_MS: "1500",
      },
    },
    {
      command: logTo("claude"),
      url: `http://localhost:${PORTS.claude}`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
      env: {
        ...isolatedEnv,
        INVENTORY_AI_MODE: "claude",
        INVENTORY_AI_ACCESS_CODE: "e2e-code",
        // AI を使う設定にするが、送信先は接続を拒む手元のポート(9番)にする(外部に接続しない・費用はかからない)
        ANTHROPIC_API_KEY: "sk-ant-e2e-dummy",
        ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
        INVENTORY_AI_PER_HOUR: "1000",
        INVENTORY_AI_DAILY_LIMIT: "1",
      },
    },
  ],
});
