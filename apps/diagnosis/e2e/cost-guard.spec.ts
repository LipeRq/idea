import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { readPdf } from "../src/test-utils/pdf";
import { diagnoseKnownInput } from "./helpers";

// AIの1日の呼び出し上限(AI_DAILY_LIMIT)を超えたときに、画面を壊さず標準レポートで返すこと。
// このプロジェクトのサーバーは AI_DAILY_LIMIT=1 で、AIの送信先を fetch が接続を拒む手元のポートにしている
// (playwright.config.ts)。外部には接続せず、費用もかからない。

const knownInput = {
  companyName: "テスト工業",
  industry: "製造業",
  employees: "31〜100名",
  hourlyCost: 3000,
  taskHours: { minutes: 100 },
  readiness: { dataLocation: 3, manuals: 3, aiUsage: 3, itStaff: 3, rules: 3, leadership: 3 },
  goals: [],
};

test("上限を超えたらAIを呼ばずに標準レポートを表示し、理由を案内する。PDFも作れる", async ({
  page,
  request,
}) => {
  // 1回目は上限内なのでAIを呼ぶ(接続できずに失敗し、理由なしの標準レポートになる。サーバーログにエラーが出る)
  const first = await request.post("/api/diagnose", { data: knownInput });
  expect(first.status()).toBe(200);
  const firstBody = await first.json();
  expect(firstBody.aiGenerated).toBe(false);
  expect(firstBody).not.toHaveProperty("fallbackReason");

  // 2回目は上限を超えているので、AIを呼ばずに返す
  const responding = page.waitForResponse("**/api/diagnose");
  await diagnoseKnownInput(page);
  const body = await (await responding).json();
  expect(body.aiGenerated).toBe(false);
  expect(body.fallbackReason).toBe("daily_limit");

  await expect(page.getByText("標準レポートです(AIによる個別分析は行っていません)")).toBeVisible();
  await expect(page.getByText(/本日はAIによる分析の受付数が上限に達したため、標準レポートを表示しています/)).toBeVisible();
  // 数値はAIの有無にかかわらず同じ
  await expect(page.getByRole("region", { name: "年間の削減見込み額" })).toContainText("216万円");
  await expect(page.getByRole("heading", { name: "優先して取り組む施策" })).toBeVisible();

  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDFをダウンロード" }).click();
  const pdf = await readPdf(new Uint8Array(await readFile(await (await downloading).path())));
  expect(pdf.compact).toContain("標準レポートです");
  expect(pdf.compact).toContain("216万円");
});
