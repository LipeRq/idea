// AI 版の失敗と1日の上限(INVENTORY_AI_MODE=claude・接続できない宛先・1日1回 のサーバー。外部には接続しない)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { FIXTURES, LOG_DIR, MARKER } from "./constants";
import { analyzeFixture, installCspRecorder, waitForReady } from "./helpers";

test("AI に接続できないときはエラーを表示して標準の結果は残り、1日の上限を超えると受付終了を表示する", async ({ page, request }) => {
  const status = await (await request.get("/api/ai-document")).json();
  expect(status).toMatchObject({ available: true, mode: "claude", requiresAccessCode: true });

  await installCspRecorder(page);
  await page.goto("/");
  await waitForReady(page);
  await analyzeFixture(page, FIXTURES.secret);

  await page.getByRole("button", { name: "AIで詳しい仕様書を作る" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "そのまま送るもの" })).toBeVisible({ timeout: 20_000 });
  await expect(dialog).not.toContainText("デモ用の固定文章");
  await dialog.getByRole("checkbox", { name: /同意します/ }).check();
  await dialog.getByRole("checkbox", { name: /了承を得ています/ }).check();
  await dialog.getByLabel("アクセスコード").fill("e2e-code");
  const send = dialog.getByRole("button", { name: "同意してAI版を作成" });

  // 1回目: 接続できない
  await send.click();
  await expect(dialog.getByRole("alert")).toContainText(/接続できませんでした|失敗しました/, { timeout: 60_000 });
  // 2回目: 1日の上限(失敗した依頼も数える)
  await send.click();
  await expect(dialog.getByRole("alert")).toContainText("本日のAI版の受付は終了しました");

  // 標準の結果はそのまま残る
  await dialog.getByRole("button", { name: "やめる" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("tab", { name: "概要" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "AIによる解説" })).toHaveCount(0);

  const log = readFileSync(join(LOG_DIR, "claude.log"), "utf8");
  expect(log).toContain('"outcome":"ai_error"');
  expect(log).toContain('"outcome":"daily_limit"');
  for (const word of [MARKER.source, MARKER.password, MARKER.apiKey, FIXTURES.secret, "sk-ant-e2e-dummy"]) {
    expect(log, `サーバーのログに ${word}`).not.toContain(word);
  }
});
