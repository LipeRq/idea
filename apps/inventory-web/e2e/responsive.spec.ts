// スマホ幅とダークモード、AI 版が無効な環境の表示(AI 版は無効のサーバー)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { fixturePath, FIXTURES } from "./constants";
import { expectNoCspViolations, expectNoHorizontalScroll, fileInput, findLowContrastText, installCspRecorder, openTab, recordRequests, waitForReady } from "./helpers";

const SAMPLES: { file: string; title: string }[] = JSON.parse(readFileSync(join(__dirname, "../../inventory/samples/manifest.json"), "utf8"));
const TABS = [/^概要$/, /^リスク/, "処理の流れ", /^モジュール・処理/, "依存関係", /^シート/, "仕様書(全文)"];
const MULTI = [FIXTURES.linker, FIXTURES.second, FIXTURES.access, FIXTURES.truncated, FIXTURES.docx];

/** 複数ファイルを解析して、棚卸し一覧を出す */
async function analyzeMulti(page: import("@playwright/test").Page) {
  await fileInput(page).setInputFiles(MULTI.map(fixturePath));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("棚卸し一覧(5 ファイル)", { timeout: 60_000 });
  await expect(page.locator('figure[data-diagram-status="done"] svg').first()).toBeVisible({ timeout: 20_000 });
}

async function analyzeSample(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: `サンプル「${SAMPLES[0].title}」で試す` }).click();
  await expect(page.locator('main[data-view="result"]')).toBeAttached({ timeout: 30_000 });
}

test.describe("スマホ幅(390px)", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });

  test("選択・結果の各タブで、ページ全体に横スクロールが出ない", async ({ page }) => {
    await installCspRecorder(page);
    await page.goto("/");
    await waitForReady(page);
    await expectNoHorizontalScroll(page);
    await analyzeSample(page);
    for (const tab of TABS) {
      await openTab(page, tab);
      if (tab === "処理の流れ") await expect(page.locator('figure[data-diagram-status="done"]').first()).toBeVisible({ timeout: 20_000 });
      await expectNoHorizontalScroll(page);
    }
    await expectNoCspViolations(page);
  });

  test("棚卸し一覧と、詳細タブ(モジュール・Access)でも、ページ全体に横スクロールが出ない", async ({ page }) => {
    await installCspRecorder(page);
    await page.goto("/");
    await waitForReady(page);
    await analyzeMulti(page);
    await expectNoHorizontalScroll(page);
    // 表は枠の中でスクロールする
    const frame = page.getByRole("region", { name: "棚卸し一覧" });
    expect(await frame.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await page.getByRole("button", { name: `${FIXTURES.linker}の詳細を見る` }).click();
    await openTab(page, /^モジュール・処理/);
    await page.locator("details > summary").first().click();
    await expectNoHorizontalScroll(page);
    await openTab(page, "依存関係");
    await expectNoHorizontalScroll(page);
    await page.getByRole("button", { name: "棚卸し一覧に戻る" }).click();
    await page.getByRole("button", { name: `${FIXTURES.access}の詳細を見る` }).click();
    await openTab(page, "Access");
    await expectNoHorizontalScroll(page);
    await expectNoCspViolations(page);
  });

  test("一覧の方の保存ボタン・一覧に戻るボタンが、スマホ幅で押せる", async ({ page }) => {
    await page.goto("/");
    await waitForReady(page);
    await analyzeMulti(page);
    for (const name of [/^一覧を保存/, /^表計算ソフト用に保存/]) await expect(page.getByRole("button", { name })).toBeVisible();
  });

  test("how-it-works も横スクロールが出ない", async ({ page }) => {
    await page.goto("/how-it-works");
    await expectNoHorizontalScroll(page);
  });
});

for (const scheme of ["dark", "light"] as const) {
  test(`${scheme === "dark" ? "ダーク" : "ライト"}モードで、背景の色と文字のコントラストが保たれる`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await installCspRecorder(page);
    await page.goto("/");
    await waitForReady(page);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe(scheme === "dark" ? "rgb(13, 13, 13)" : "rgb(249, 249, 247)");
    expect(await findLowContrastText(page)).toEqual([]);

    await analyzeSample(page);
    for (const tab of TABS) {
      await openTab(page, tab);
      if (tab === "処理の流れ") {
        const frame = page.locator(".diagram-frame").first();
        await expect(frame.locator("svg")).toBeVisible({ timeout: 20_000 });
        // 図はテーマに関係なく白い枠の中にライトの配色で描く(印刷・HTML 保存と同じ見た目)
        expect(await frame.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
      }
      expect(await findLowContrastText(page), `タブ ${tab}`).toEqual([]);
    }
    await expectNoCspViolations(page);
  });
}

for (const scheme of ["dark", "light"] as const) {
  test(`${scheme === "dark" ? "ダーク" : "ライト"}モードで、棚卸し一覧と詳細タブの文字のコントラストが保たれる`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await installCspRecorder(page);
    await page.goto("/");
    await waitForReady(page);
    await analyzeMulti(page);
    expect(await findLowContrastText(page), "棚卸し一覧").toEqual([]);
    // 一覧の関係図は、テーマに関係なく白い枠にライトの配色で描く
    expect(await page.locator(".diagram-frame").first().evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");

    await page.getByRole("button", { name: `${FIXTURES.linker}の詳細を見る` }).click();
    for (const tab of TABS) {
      await openTab(page, tab);
      if (tab instanceof RegExp && tab.source.startsWith("^モジュール")) await page.locator("details > summary").first().click();
      expect(await findLowContrastText(page), `タブ ${tab}`).toEqual([]);
    }
    await page.getByRole("button", { name: "棚卸し一覧に戻る" }).click();
    await page.getByRole("button", { name: `${FIXTURES.access}の詳細を見る` }).click();
    await openTab(page, "Access");
    await page.getByText("SQL を表示").first().click();
    expect(await findLowContrastText(page), "Access タブ").toEqual([]);
    await expectNoCspViolations(page);
  });
}

test("AI 版が使えない環境では、AI のボタンを出さず、送信もしない", async ({ page, context, request }) => {
  const status = await (await request.get("/api/ai-document")).json();
  expect(status).toMatchObject({ available: false, mode: "off" });

  const requests = recordRequests(context);
  await page.goto("/");
  await waitForReady(page);
  await analyzeSample(page);
  await expect(page.getByRole("button", { name: /AIで/ })).toHaveCount(0);
  expect(requests.filter((r) => r.method !== "GET")).toEqual([]);
});
