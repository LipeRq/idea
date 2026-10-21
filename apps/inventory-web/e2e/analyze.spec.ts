// サンプルと自分のファイルの解析 → 結果表示 → 保存・印刷(AI 版は無効のサーバー)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { fixturePath, FIXTURES } from "./constants";
import {
  analyzeFixture,
  backToSelect,
  downloadBy,
  expectNoCspViolations,
  fileInput,
  installCspRecorder,
  openTab,
  openTechnicalExports,
  saveHtmlReport,
  waitForReady,
} from "./helpers";

interface Sample {
  file: string;
  title: string;
}
const SAMPLES: Sample[] = JSON.parse(readFileSync(join(__dirname, "../../inventory/samples/manifest.json"), "utf8"));

test.beforeEach(async ({ page }) => {
  await installCspRecorder(page);
  await page.goto("/");
  await waitForReady(page);
});

test("サンプルを解析して、各タブの表示と保存・印刷ができる", async ({ page }) => {
  const buttons = page.getByRole("button", { name: /^サンプル「.+」で試す$/ });
  await expect(buttons).toHaveCount(SAMPLES.length);

  const sample = SAMPLES[0];
  const stem = sample.file.replace(/\.[^.]+$/, "");
  await page.getByRole("button", { name: `サンプル「${sample.title}」で試す` }).click();
  await expect(page.locator('main[data-view="result"]')).toBeAttached({ timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toContainText(sample.file);

  // 概要
  await expect(page.getByRole("heading", { name: "規模" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /移行の難しさの目安/ })).toBeVisible();
  // リスク
  await openTab(page, /^リスク/);
  await expect(page.getByRole("tabpanel").locator("li").first()).toBeVisible();
  // 処理の流れ(図が SVG で描ける)
  await openTab(page, "処理の流れ");
  const diagram = page.getByRole("tabpanel").locator('figure[data-diagram-status="done"] svg').first();
  await expect(diagram).toBeVisible({ timeout: 20_000 });
  // 仕様書の全文(図も SVG になる)
  await openTab(page, "仕様書(全文)");
  const doc = page.getByRole("tabpanel").locator(".doc-body");
  await expect(doc.locator("h1")).toContainText(sample.file);
  await expect(doc.locator(".mermaid-src svg").first()).toBeVisible({ timeout: 20_000 });

  // HTML(スクリプトなし・外部を読みに行かない単体の HTML)
  const html = await saveHtmlReport(page);
  expect(html.name).toBe(`${stem}_棚卸し.html`);
  expect(html.text).toContain('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'');
  expect(html.text).not.toMatch(/<script/i);
  expect(html.text).not.toMatch(/\son[a-z]+=/i);
  expect(html.text).toContain("<svg");
  expect(html.text).toContain(`<title>棚卸しレポート: ${sample.file}</title>`);

  // Markdown(エンジンの renderMarkdown そのまま)と抽出結果(JSON)
  await openTechnicalExports(page);
  const md = await downloadBy(page, () => page.getByRole("button", { name: "仕様書(Markdown)" }).click());
  expect(md.name).toBe(`${stem}_棚卸し.md`);
  expect(md.text).toContain(sample.file);
  expect(md.text).toMatch(/^## /m);
  expect(md.text).toContain("```mermaid");
  const json = await downloadBy(page, () => page.getByRole("button", { name: "抽出結果(JSON)" }).click());
  expect(json.name).toBe(`${stem}_抽出結果.json`);
  const report = JSON.parse(json.text);
  expect(report.file.name).toBe(sample.file);
  expect(report.vba.modules.length).toBeGreaterThan(0);

  // 印刷: 画面の部品は消え、仕様書だけが出る
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("button", { name: /^レポートを保存/ })).toBeHidden();
  await expect(page.locator(".print-only .doc-body h1")).toBeVisible();
  await page.emulateMedia({ media: "screen" });

  await expectNoCspViolations(page);
});

test("すべてのサンプルがエラーなく解析できる", async ({ page }) => {
  for (const [i, sample] of SAMPLES.entries()) {
    if (i > 0) await backToSelect(page);
    await page.getByRole("button", { name: `サンプル「${sample.title}」で試す` }).click();
    await expect(page.locator('main[data-view="result"]'), sample.file).toBeAttached({ timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1 })).toContainText(sample.file);
    // サンプルの見どころに書いたリスクが検出されている(リスクのタブに件数が出る)
    await expect(page.getByRole("tab", { name: /^リスク\(\d+\)$/ })).not.toHaveText("リスク(0)");
  }
  await expectNoCspViolations(page);
});

test("Access ファイルを解析すると、クエリとテーブルの関係図が出る", async ({ page }) => {
  await analyzeFixture(page, FIXTURES.access);
  await expect(page.getByText(/テーブルが \d+ 個、保存済みのクエリが \d+ 個あります/)).toBeVisible();
  await openTab(page, "処理の流れ");
  await expect(page.getByRole("heading", { name: "クエリとテーブルの関係図" })).toBeVisible();
  await expect(page.getByRole("tabpanel").locator('figure[data-diagram-status="done"] svg').first()).toBeVisible({ timeout: 20_000 });
  await expectNoCspViolations(page);
});

for (const target of ["dropzone", "outside"] as const) {
  test(target === "dropzone" ? "ドラッグ&ドロップでも解析できる" : "ドロップゾーンの外に落としても、ブラウザがファイルを開かずに解析する", async ({ page }) => {
    const base64 = readFileSync(fixturePath(FIXTURES.second)).toString("base64");
    await page.evaluate(
      ({ base64, name, target }) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([bytes], name));
        const el = target === "dropzone" ? document.querySelector('[data-dropzone="true"]')! : document.querySelector("footer") ?? document.body;
        for (const type of ["dragenter", "dragover", "drop"]) {
          el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
        }
      },
      { base64, name: FIXTURES.second, target },
    );
    await expect(page.locator('main[data-view="result"]')).toBeAttached({ timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1 })).toContainText(FIXTURES.second);
    expect(page.url()).toMatch(/\/$/);
  });
}

test("キーボードだけでファイルの選択ダイアログを開ける", async ({ page }) => {
  let focused = false;
  for (let i = 0; i < 15 && !focused; i++) {
    await page.keyboard.press("Tab");
    focused = await fileInput(page).evaluate((el) => el === document.activeElement);
  }
  expect(focused, "Tab でファイル選択に移動できない").toBe(true);
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.keyboard.press("Enter")]);
  await chooser.setFiles(fixturePath(FIXTURES.second));
  await expect(page.locator('main[data-view="result"]')).toBeAttached({ timeout: 30_000 });
});
