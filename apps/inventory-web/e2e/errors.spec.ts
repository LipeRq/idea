// 解析できないファイルのエラー表示(docs/design.md §2.3)
import { expect, test } from "@playwright/test";
import { fixturePath, FIXTURES } from "./constants";
import { expectNoCspViolations, fileInput, installCspRecorder, waitForReady } from "./helpers";

test.beforeEach(async ({ page }) => {
  await installCspRecorder(page);
  await page.goto("/");
  await waitForReady(page);
});

async function expectErrorView(page: import("@playwright/test").Page, fileName: string, title: RegExp, hint: RegExp) {
  await expect(page.locator('main[data-view="error"]')).toBeAttached({ timeout: 30_000 });
  const alert = page.locator("main").getByRole("alert");
  await expect(alert).toContainText(title);
  await expect(alert).toContainText(hint);
  await expect(alert).toContainText(fileName);
  // 内部の情報(スタック・クラス名・コマンドラインの案内)は出さない
  await expect(page.locator("main")).not.toContainText(/--password|Error:|at [A-Za-z]+ \(|CorruptFileError|UnsupportedFileError/);
}

test("途中で切れた .xlsm は、壊れている旨と対処を表示し、別のファイルを選び直せる", async ({ page }) => {
  await fileInput(page).setInputFiles(fixturePath(FIXTURES.truncated));
  await expectErrorView(page, FIXTURES.truncated, /壊れ|読み取れ|zip/, /保存し直す/);
  const back = page.getByRole("button", { name: "別のファイルを選ぶ" });
  await expect(back).toBeFocused();
  await back.click();
  await expect(page.locator('main[data-view="select"]')).toBeAttached();
  await expect(page.getByText("解析するファイルをここにドラッグ&ドロップ")).toBeVisible();
});

test("拡張子だけ .xlsm のでたらめなファイルは、エラーを表示する", async ({ page }) => {
  await fileInput(page).setInputFiles(fixturePath(FIXTURES.random));
  await expect(page.locator('main[data-view="error"]')).toBeAttached({ timeout: 30_000 });
  await expect(page.locator("main").getByRole("alert")).toContainText(FIXTURES.random);
  await expect(page.getByRole("button", { name: "別のファイルを選ぶ" })).toBeVisible();
});

test("対応していない形式(.docx)は、読み込まずに対応形式を案内する", async ({ page }) => {
  await fileInput(page).setInputFiles(fixturePath(FIXTURES.docx));
  const alert = page.locator("main").getByRole("alert");
  await expect(alert).toContainText("この形式(.docx)には対応していません");
  await expect(alert).toContainText(".xlsm");
  // 解析は始まらない(選択画面のまま)
  await expect(page.locator('main[data-view="select"]')).toBeAttached();
});

test("パスワード付きの Access は、専用の文言で案内する(コマンドライン版の案内は出さない)", async ({ page }) => {
  await fileInput(page).setInputFiles(fixturePath(FIXTURES.passwordAccess));
  await expectErrorView(
    page,
    FIXTURES.passwordAccess,
    /パスワード付きの Access ファイルは、この画面では解析できません/,
    /パスワードを解除して別名で保存/,
  );
  await expectNoCspViolations(page);
});
