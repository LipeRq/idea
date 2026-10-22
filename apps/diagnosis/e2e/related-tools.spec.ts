import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { RELATED_TOOL_REASONS, RELATED_TOOLS } from "../src/lib/diagnosis/related-tools";
import { readPdf } from "../src/test-utils/pdf";
import { E2E_INVENTORY_TOOL_URL } from "./constants";
import {
  answerAllReadiness,
  diagnoseKnownInput,
  fillCompanyStep,
  fillHoursStep,
  nextButton,
  readinessRadio,
  submitAndWaitForResult,
} from "./helpers";

// 結果画面の「あわせて使えるツール」。入力から決まったルールで案内する(src/lib/diagnosis/related-tools.ts)。
// E2Eのビルドでは、棚卸しツールはリンクあり、見積アシストのデモはリンクなし(相談フォームへ誘導)にしている(playwright.config.ts)。

const INVENTORY = RELATED_TOOLS.inventoryTool;
const QUOTE = RELATED_TOOLS.quoteAssistDemo;

function relatedTools(page: Page) {
  return page.getByRole("region", { name: "あわせて使えるツール" });
}

function card(page: Page, title: string) {
  return relatedTools(page)
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { level: 4, name: title, exact: true }) });
}

function leadForm(page: Page) {
  const form = page.getByRole("form", { name: "無料相談のお申し込み" });
  return {
    form,
    topics: form.getByRole("group", { name: /^相談したいテーマ/ }),
    topic: (name: string) => form.getByRole("checkbox", { name, exact: true }),
    message: form.getByRole("textbox", { name: /^相談したい内容/ }),
  };
}

test("製造業で見積の工数と記述、Excelマクロの記述がある → 2つを理由つきで案内。リンクは別タブ、デモは相談フォームへ。PDFにも入り、計測に個人情報を送らない", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await fillCompanyStep(page, {
    companyName: "テスト精機",
    industry: "製造業",
    employees: "11〜30名",
    challenges: "Excelマクロで作った見積の仕組みを担当者しか直せない",
  });
  await nextButton(page).click();
  await fillHoursStep(page, { documents: 30 });
  await nextButton(page).click();
  await answerAllReadiness(page, 3);
  await submitAndWaitForResult(page);

  const section = relatedTools(page);
  await expect(section).toContainText("決まったルールで選んだ参考情報です");
  await expect(section).toContainText("効果を保証するものではありません");
  await expect(section.getByRole("heading", { level: 4 })).toHaveText([INVENTORY.title, QUOTE.title]);

  // 棚卸しツール:リンク先が設定されているので、別タブで開くリンクを出す
  const inventory = card(page, INVENTORY.title);
  await expect(inventory).toContainText(RELATED_TOOL_REASONS.inventoryKeyword);
  await expect(inventory).not.toContainText("無料相談でご案内します");
  const link = inventory.getByRole("link", { name: /^無料ツールを開く/ });
  await expect(link).toHaveAttribute("href", E2E_INVENTORY_TOOL_URL);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(inventory.getByRole("button")).toHaveCount(0);

  // 見積アシストのデモ:リンク先が未設定なので「無料相談でご案内します」として相談フォームへ誘導する
  const quote = card(page, QUOTE.title);
  await expect(quote).toContainText(RELATED_TOOL_REASONS.quoteDocumentHours);
  await expect(quote).toContainText(RELATED_TOOL_REASONS.quoteKeyword);
  await expect(quote).toContainText("無料相談でご案内します。");
  await expect(quote.getByRole("link")).toHaveCount(0);

  // リンクを押すと別タブで開く(外部には接続せず、テストの中で応答する)。参照元と opener を渡さない
  let referer: string | undefined = "not requested";
  await context.route(`${E2E_INVENTORY_TOOL_URL}**`, async (route) => {
    referer = route.request().headers()["referer"];
    await route.fulfill({ contentType: "text/html", body: "<title>inventory</title>" });
  });
  const popupPromise = page.waitForEvent("popup");
  await link.click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  expect(popup.url()).toBe(E2E_INVENTORY_TOOL_URL);
  expect(referer).toBeUndefined();
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  await popup.close();

  // デモのボタン → 相談フォームの「相談したい内容」に「見積アシストのデモ希望」が入り、そこへフォーカスが移る
  const f = leadForm(page);
  await expect(f.topic(QUOTE.leadTopic)).not.toBeChecked();
  await quote.getByRole("button", { name: QUOTE.leadButtonLabel }).click();
  await expect(f.message).toBeFocused();
  await expect(f.message).toHaveValue(QUOTE.leadTopic);
  await expect(f.topic(QUOTE.leadTopic)).toBeChecked();
  await expect(f.topic(INVENTORY.leadTopic)).not.toBeChecked();

  // テーマは選び直せる(外すと欄から消え、書いた内容は残る)
  await f.message.press("End");
  await f.message.pressSequentially("\n費用感も知りたい");
  await f.topic(QUOTE.leadTopic).uncheck();
  await expect(f.message).toHaveValue("費用感も知りたい");
  await f.topic(QUOTE.leadTopic).check();
  await expect(f.message).toHaveValue(`${QUOTE.leadTopic}\n費用感も知りたい`);

  // 申し込むと、テーマは「相談したい内容」の文章として送られる
  await f.form.getByRole("textbox", { name: /^氏名/ }).fill("山田 太郎");
  await f.form.getByRole("textbox", { name: /^メールアドレス/ }).fill("taro@example.co.jp");
  await f.form.getByRole("checkbox", { name: /個人情報の取り扱い/ }).check();
  const leadRequest = page.waitForRequest("**/api/lead");
  await f.form.getByRole("button", { name: "無料相談を申し込む" }).click();
  expect((await leadRequest).postDataJSON().contact.message).toBe(`${QUOTE.leadTopic}\n費用感も知りたい`);
  await expect(page.getByRole("heading", { name: "お申し込みを受け付けました" })).toBeVisible();

  // PDFにも同じ案内(リンクは設定されているものだけ)
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDFをダウンロード" }).click();
  const pdf = await readPdf(new Uint8Array(await readFile(await (await downloading).path())));
  for (const expected of [
    "あわせて使えるツール",
    INVENTORY.title,
    `無料ツールを開く:${E2E_INVENTORY_TOOL_URL}`,
    QUOTE.title,
    "無料相談でご案内します。",
  ]) {
    expect(pdf.compact).toContain(expected);
  }

  // 計測:案内を押したことと、押した案内・移り先だけを送る
  const events = await page.evaluate(
    () => (window as unknown as { __analyticsEvents?: { name: string; params: unknown }[] }).__analyticsEvents,
  );
  const clicks = events?.filter((e) => e.name === "related_tool_click");
  expect(clicks).toEqual([
    { name: "related_tool_click", params: { tool: "inventoryTool", destination: "link" } },
    { name: "related_tool_click", params: { tool: "quoteAssistDemo", destination: "lead_form" } },
  ]);
  const sent = JSON.stringify(events);
  for (const personal of ["テスト精機", "Excelマクロ", "山田", "taro", "費用感", "30"]) {
    expect(sent).not.toContain(personal);
  }
});

test("製造業以外で、データ入力・集計が多く保存場所が個人PCのExcel → 棚卸しツールだけを案内する", async ({ page }) => {
  await page.goto("/");
  await fillCompanyStep(page, { industry: "卸売・小売業", employees: "31〜100名" });
  await nextButton(page).click();
  await fillHoursStep(page, { dataEntry: 30, reporting: 20, documents: 40 });
  await nextButton(page).click();
  await answerAllReadiness(page, 3);
  // 業務データの主な保存場所:個人PCのExcel・Wordが中心
  await readinessRadio(page, 0, 1).check();
  await submitAndWaitForResult(page);

  const section = relatedTools(page);
  await expect(section.getByRole("heading", { level: 4 })).toHaveText([INVENTORY.title]);
  await expect(card(page, INVENTORY.title)).toContainText(RELATED_TOOL_REASONS.inventoryDataWork);
  // 見積書の工数が多くても、製造業でなければデモは案内しない
  await expect(page.getByText(QUOTE.title)).toHaveCount(0);

  const f = leadForm(page);
  await expect(f.topics.getByRole("checkbox")).toHaveCount(1);
  await expect(f.topic(INVENTORY.leadTopic)).not.toBeChecked();
});

test("どのルールにも当てはまらなければ、案内の節と相談フォームのテーマ欄を出さない", async ({ page }) => {
  // 製造業だが、議事録だけ・準備度すべて最高・「いま困っていること」なし
  await diagnoseKnownInput(page);
  await expect(relatedTools(page)).toHaveCount(0);
  await expect(page.getByText(INVENTORY.title)).toHaveCount(0);
  await expect(leadForm(page).topics).toHaveCount(0);
});
