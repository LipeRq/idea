// スマホ幅とダークモード、AI 版が無効な環境の表示(AI 版は無効のサーバー)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { expectNoCspViolations, expectNoHorizontalScroll, findLowContrastText, installCspRecorder, openTab, recordRequests, waitForReady } from "./helpers";

const SAMPLES: { file: string; title: string }[] = JSON.parse(readFileSync(join(__dirname, "../../inventory/samples/manifest.json"), "utf8"));
const TABS = [/^概要$/, /^リスク/, "処理の流れ", "仕様書(全文)"];

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
