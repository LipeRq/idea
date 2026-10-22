// 複数ファイルの解析・棚卸し一覧・詳細タブ(AI 版は無効のサーバー)
import { expect, test, type Page } from "@playwright/test";
import { fixturePath, FIXTURES } from "./constants";
import {
  analyzeFixture,
  downloadBy,
  expectNoCspViolations,
  fileInput,
  installCspRecorder,
  openTab,
  openTechnicalExports,
  saveHtmlReport,
  waitForReady,
} from "./helpers";

/** 一覧・関係図・エラー・対象外が揃う5ファイル(連携元は、売上管理・Access・DB・解析しないブックを参照する) */
const FIVE = [FIXTURES.linker, FIXTURES.second, FIXTURES.access, FIXTURES.truncated, FIXTURES.docx];

test.beforeEach(async ({ page }) => {
  await installCspRecorder(page);
  await page.goto("/");
  await waitForReady(page);
});

async function analyzeMany(page: Page, names: string[]) {
  await fileInput(page).setInputFiles(names.map(fixturePath));
  await expect(page.locator('main[data-view="result"]')).toBeAttached({ timeout: 60_000 });
}

const listTable = (page: Page) => page.getByRole("region", { name: "棚卸し一覧" });

test("複数ファイルを順に解析し、棚卸し一覧で規模・リスク・移行難易度・外部依存を比べられる(1件失敗・1件対象外でも続く)", async ({ page }) => {
  await analyzeMany(page, FIVE);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("棚卸し一覧(5 ファイル)");
  const rows = listTable(page).locator("tbody tr");
  await expect(rows).toHaveCount(5);
  await expect(page.locator('tr[data-row-status="解析済み"]')).toHaveCount(3);
  await expect(page.locator('tr[data-row-status="エラー"]')).toContainText(FIXTURES.truncated);
  await expect(page.locator('tr[data-row-status="エラー"]')).toContainText(/壊れ|読み取れ|zip|保存し直す/);
  await expect(page.locator('tr[data-row-status="対象外"]')).toContainText("この形式(.docx)には対応していません");

  // 行は選んだ順(連携元・売上管理・Access・壊れたブック・.docx)
  const linker = rows.nth(0);
  await expect(linker).toContainText("Excel");
  await expect(linker).toContainText(/コード [\d,]+ 行/);
  await expect(linker).toContainText(/高 \d+/);
  await expect(linker).toContainText("他のブック");
  await expect(linker).toContainText("Access 1");
  await expect(linker).toContainText("DB");
  // Access は、シートではなくテーブルとクエリ
  await expect(rows.nth(2)).toContainText(FIXTURES.access);
  await expect(rows.nth(2)).toContainText(/テーブル \d+/);
  await expect(rows.nth(2)).toContainText(/クエリ \d+/);

  // ファイル間の関係図(連携元 → 売上管理・Access・DB・未解析のブック)
  const diagram = page.locator('figure[data-diagram-status="done"] svg').first();
  await expect(diagram).toBeVisible({ timeout: 20_000 });
  const text = (await diagram.textContent()) ?? "";
  for (const word of [FIXTURES.linker, FIXTURES.second, FIXTURES.access, "sql-e2e01", "月次集計.xlsx(未解析)"]) expect(text).toContain(word);
  await page.getByText(/参照関係の一覧/).click();
  await expect(page.getByText(`${FIXTURES.linker} → ${FIXTURES.second}(`)).toBeVisible();
  await expect(page.getByText(`${FIXTURES.linker} → ${FIXTURES.access}(`)).toBeVisible();
  await expectNoCspViolations(page);
});

test("棚卸し一覧は HTML・CSV・Markdown で保存できる", async ({ page }) => {
  await analyzeMany(page, FIVE);
  await expect(page.locator('figure[data-diagram-status="done"] svg').first()).toBeVisible({ timeout: 20_000 });

  const html = await saveHtmlReport(page, /^一覧を保存/);
  expect(html.name).toBe("棚卸し一覧.html");
  expect(html.text).toContain('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'');
  expect(html.text).not.toMatch(/<script/i);
  expect(html.text).not.toMatch(/\son[a-z]+=/i);
  expect(html.text).toContain("<svg");
  for (const name of FIVE) expect(html.text).toContain(name);

  const csv = await downloadBy(page, () => page.getByRole("button", { name: /^表計算ソフト用に保存/ }).click());
  expect(csv.name).toBe("棚卸し一覧.csv");
  expect(csv.text.startsWith("﻿ファイル名,状態,")).toBe(true);
  const lines = csv.text.trim().split("\r\n");
  expect(lines).toHaveLength(6);
  expect(lines.filter((l) => l.includes(",解析済み,"))).toHaveLength(3);
  expect(lines.find((l) => l.startsWith(FIXTURES.truncated))).toContain(",エラー,");
  expect(lines.find((l) => l.startsWith(FIXTURES.docx))).toContain(",対象外,");

  await openTechnicalExports(page);
  const md = await downloadBy(page, () => page.getByRole("button", { name: "一覧(Markdown)" }).click());
  expect(md.name).toBe("棚卸し一覧.md");
  expect(md.text).toContain("# 棚卸し一覧");
  expect(md.text).toContain("```mermaid");
  expect(md.text).toContain(`| ${FIXTURES.linker} |`);
  await expectNoCspViolations(page);
});

test("一覧からファイルを選ぶと詳細タブ(モジュール・依存関係・シート)が開き、一覧に戻れる", async ({ page }) => {
  await analyzeMany(page, FIVE);
  await page.getByRole("button", { name: `${FIXTURES.linker}の詳細を見る` }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(`棚卸しの結果: ${FIXTURES.linker}`);

  // モジュール・プロシージャ(行数・引数・エラー処理・呼び出し元/先)
  await openTab(page, /^モジュール・処理/);
  await page.locator("details > summary", { hasText: /^連携/ }).first().click();
  const proc = page.getByRole("row", { name: /データを集める/ });
  await expect(proc).toBeVisible();
  await expect(proc).toContainText("なし"); // エラー処理・引数・呼び出し元は無い
  await page.locator("details > summary", { hasText: "売上集計" }).first().click();
  await expect(page.getByRole("columnheader", { name: "エラー処理" }).first()).toBeVisible();
  await page.getByText("ソースコードを表示").first().click();
  await expect(page.locator("pre").first()).toContainText(/Sub|Function|Option/);

  // 依存関係
  await openTab(page, "依存関係");
  await expect(page.getByRole("heading", { name: /他ブックの操作/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /DB接続文字列/ })).toBeVisible();
  await expect(page.getByText(`${FIXTURES.second}`).first()).toBeVisible();

  // シート
  await openTab(page, /^シート/);
  await expect(page.getByRole("heading", { name: /^シート/ }).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "シートの一覧" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /外部リンク/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Access" })).toHaveCount(0);

  // 一覧に戻る
  await page.getByRole("button", { name: "棚卸し一覧に戻る" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("棚卸し一覧(5 ファイル)");
  await expectNoCspViolations(page);
});

test("Access の詳細タブにテーブル・クエリ・リレーションシップが出る", async ({ page }) => {
  await analyzeMany(page, FIVE);
  await page.getByRole("button", { name: `${FIXTURES.access}の詳細を見る` }).click();
  await openTab(page, "Access");
  await expect(page.getByRole("heading", { name: /^テーブル/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "テーブルの一覧" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^クエリ/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "クエリの一覧" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^リレーションシップ/ })).toBeVisible();
  // SQL は開いたときに描く
  await page.getByText("SQL を表示").first().click();
  await expect(page.locator("pre").filter({ hasText: /SELECT|UPDATE|INSERT|DELETE/i }).first()).toBeVisible();
  await expect(page.getByRole("tab", { name: /^シート/ })).toHaveCount(0);
});

test("11ファイルは何も始めずに案内し、1ファイルだけなら一覧を出さず従来どおり結果を表示する", async ({ page }) => {
  await fileInput(page).setInputFiles(Array.from({ length: 11 }, () => fixturePath(FIXTURES.second)));
  await expect(page.locator("main").getByRole("alert")).toContainText("一度に解析できるのは10ファイル");
  await expect(page.locator('main[data-view="select"]')).toBeAttached();

  await analyzeFixture(page, FIXTURES.second);
  await expect(page.getByRole("button", { name: "棚卸し一覧に戻る" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /棚卸し一覧/ })).toHaveCount(0);
  // 詳細タブは1ファイルでも使える
  await openTab(page, /^モジュール・処理/);
  await expect(page.locator("details > summary").first()).toBeVisible();
});

test("全部が解析できないときは、すべての理由を選択画面に出す", async ({ page }) => {
  await fileInput(page).setInputFiles([fixturePath(FIXTURES.docx), fixturePath(FIXTURES.docx)]);
  await expect(page.locator("main").getByRole("alert")).toContainText("解析できるファイルがありませんでした");
  await expect(page.locator('main[data-view="select"]')).toBeAttached();
});

test("大きな結果(モジュール300・処理4,500)でも、画面が固まらず「さらに表示」で少しずつ見られる", async ({ page }) => {
  await analyzeFixture(page, FIXTURES.large);
  const started = Date.now();
  await openTab(page, /^モジュール・処理\(300\)/);
  const items = page.getByRole("tabpanel").locator("ul > li", { has: page.locator("details") });
  await expect(items).toHaveCount(200);
  expect(Date.now() - started, "モジュールのタブが開くまでの時間(ms)").toBeLessThan(5_000);
  await page.getByRole("button", { name: /モジュールをさらに表示/ }).click();
  await expect(items).toHaveCount(300);

  // モジュールを開くと、処理の一覧が出る(開いたときに初めて描く)。操作から表示までが速い
  const t = Date.now();
  await items.first().locator("summary").click();
  await expect(items.first().getByRole("row")).toHaveCount(1 + 15, { timeout: 5_000 });
  expect(Date.now() - t, "モジュールを開くまでの時間(ms)").toBeLessThan(3_000);
  await expect(page.getByRole("button", { name: "さらに表示" })).toHaveCount(0);

  // 画面が固まっていないこと: ページのメインスレッドが、続けて操作に応答する
  const responsive = await page.evaluate(() => new Promise<number>((resolve) => {
    const start = performance.now();
    setTimeout(() => resolve(performance.now() - start), 0);
  }));
  expect(responsive).toBeLessThan(1_000);
  await openTab(page, "依存関係");
  await openTab(page, /^リスク/);
  await expectNoCspViolations(page);
});
