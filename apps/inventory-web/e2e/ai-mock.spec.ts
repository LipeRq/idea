// AI 版の同意画面と送信(INVENTORY_AI_MODE=mock・アクセスコードあり のサーバー)
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { fixturePath, FIXTURES, LOG_DIR, MARKER } from "./constants";
import {
  analyzeFixture,
  backToSelect,
  downloadBy,
  expectNoCspViolations,
  expectNoHorizontalScroll,
  installCspRecorder,
  openTechnicalExports,
  saveHtmlReport,
  recordRequests,
  waitForReady,
} from "./helpers";

const ACCESS_CODE = "e2e-access-code-0123";
const SEND = "同意してAI版を作成";

async function openConsent(page: Page) {
  await page.getByRole("button", { name: /^AIで(詳しい仕様書を作る|仕様書を作り直す)$/ }).click();
  const dialog = page.getByRole("dialog", { name: "AIで詳しい仕様書を作る" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "そのまま送るもの" })).toBeVisible({ timeout: 20_000 });
  return dialog;
}

async function agree(page: Page, code = ACCESS_CODE) {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox", { name: /Anthropic 社\(米国\)の API に送信することに同意します/ }).check();
  await dialog.getByRole("checkbox", { name: /外部の AI サービスへの送信について了承を得ています/ }).check();
  await dialog.getByLabel("アクセスコード").fill(code);
}

test.beforeEach(async ({ page }) => {
  await installCspRecorder(page);
  await page.goto("/");
  await waitForReady(page);
  await analyzeFixture(page, FIXTURES.secret);
});

test("同意画面は「そのまま送るもの」を正しく伝え、同意するまで送信しない。送信後は AI の解説を表示する", async ({ page, context, request }) => {
  const status = await (await request.get("/api/ai-document")).json();
  expect(status).toMatchObject({ available: true, mode: "mock", requiresAccessCode: true });

  const requests = recordRequests(context);
  const dialog = await openConsent(page);
  await expect(dialog).toContainText("デモ用の固定文章で動作中");

  // 送らないもの / 伏せ字にして送るもの / そのまま送るもの の3つに分けて示す
  await expect(dialog.getByRole("heading", { name: "送らないもの" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "伏せ字にして送るもの" })).toBeVisible();
  const sendAsIs = dialog.locator("section", { has: page.getByRole("heading", { name: "そのまま送るもの" }) });
  await expect(sendAsIs).toContainText("マクロ(VBA)のソースコード");
  await expect(sendAsIs).toContainText("氏名・メールアドレス・電話番号・会社名・ファイル名・APIキー・トークン・Webhook の URL(伏せ字の対象外です)");
  // 送信内容の中の、伏せ字にならない秘密を場所付きで示す
  const hits = dialog.locator("section", { has: page.getByRole("heading", { name: "送信内容の中の、注意が必要な文字列" }) });
  await expect(hits).toContainText("伏せ字にされずにそのまま送られます");
  await expect(hits).toContainText(MARKER.email);
  await expect(hits).toContainText(MARKER.apiKey);
  await expect(hits).toContainText("hooks.slack.com");
  await expect(hits).toContainText("通知連携");
  await expect(dialog).toContainText("Anthropic 社(米国)");
  // 運営者名と、プライバシーポリシー・利用規約へのリンク
  await expect(dialog).toContainText("運営者: E2E運営株式会社");
  await expect(dialog.getByRole("link", { name: /プライバシーポリシー/ })).toHaveAttribute("href", "https://example.com/privacy");
  await expect(dialog.getByRole("link", { name: /利用規約/ })).toHaveAttribute("href", "https://example.com/terms");
  // 伏せ字になったパスワードは、画面のどこにも出ない
  await expect(page.locator("body")).not.toContainText(MARKER.password);

  // 同意のチェック2つとアクセスコードがそろうまで送れない
  const send = dialog.getByRole("button", { name: SEND });
  await expect(send).toBeDisabled();
  await dialog.getByRole("checkbox", { name: /同意します/ }).check();
  await expect(send).toBeDisabled();
  await dialog.getByRole("checkbox", { name: /了承を得ています/ }).check();
  await expect(send).toBeDisabled();
  await dialog.getByLabel("アクセスコード").fill("wrong-code");
  await expect(send).toBeEnabled();
  expect(requests.filter((r) => r.method === "POST"), "同意する前に送信した").toEqual([]);

  // 「送信内容を保存」は送る文字列そのもの。作成者・ファイル名・パスワードは入らず、ソースとAPIキーは入る
  const saved = await downloadBy(page, () => dialog.getByRole("button", { name: /^送信内容を保存/ }).click());
  expect(saved.name).toBe("顧客台帳_e2e_AI送信内容.json");
  const sha256 = createHash("sha256").update(readFileSync(fixturePath(FIXTURES.secret))).digest("hex");
  const payload = JSON.parse(saved.text);
  expect(payload.report.file).toMatchObject({ name: "対象ファイル.xlsm", sha256: "" });
  expect(payload.report.properties).toMatchObject({ creator: null, lastModifiedBy: null, company: null, title: null, application: null, appVersion: null });
  // AI に要らない項目は外す(大きさ・作成したアプリ)。日時は年だけ
  expect(payload.report.file.sizeBytes).toBe(0);
  expect(payload.report.properties.created).toMatch(/^\d{4}$/);
  for (const word of [MARKER.password, MARKER.creator, MARKER.lastModifiedBy, MARKER.company, FIXTURES.secret, sha256]) {
    expect(saved.text, `送信内容に ${word}`).not.toContain(word);
  }
  expect(saved.text).toContain(MARKER.source);
  expect(saved.text).toContain(MARKER.apiKey);

  // 「ソースコード本文と SQL を送らない」と、送信内容から本文が消える
  await dialog.getByRole("checkbox", { name: /ソースコード本文とクエリの SQL を送らない/ }).check();
  await expect(sendAsIs).toContainText("ソースコード本文は送りません");
  const withoutSource = await downloadBy(page, () => dialog.getByRole("button", { name: /^送信内容を保存/ }).click());
  expect(withoutSource.text).not.toContain(MARKER.source);
  expect(JSON.parse(withoutSource.text).report.vba.modules.every((m: { source: unknown }) => m.source === null)).toBe(true);
  await dialog.getByRole("checkbox", { name: /ソースコード本文とクエリの SQL を送らない/ }).uncheck();
  await expect(sendAsIs).toContainText("マクロ(VBA)のソースコード");

  // アクセスコードが違うと断られる
  await send.click();
  await expect(dialog.getByRole("alert")).toContainText("アクセスコードが違います");

  // 正しいアクセスコードで送ると、進捗のあと「AIによる解説」のタブが開く
  await dialog.getByLabel("アクセスコード").fill(ACCESS_CODE);
  await send.click();
  await expect(dialog.getByRole("status")).toContainText("AI版を作成しています");
  await expect(page.getByRole("tab", { name: "AIによる解説" })).toHaveAttribute("aria-selected", "true", { timeout: 30_000 });
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("tabpanel")).toContainText("(デモ用の固定文章)");

  // 実際に送った本文も同じ: ソースは入る(同意した内容)が、パスワード・作成者・元のファイル名・指紋は入らない
  const posts = requests.filter((r) => r.method === "POST");
  expect(posts.length).toBe(2);
  for (const post of posts) {
    expect(new URL(post.url).pathname).toBe("/api/ai-document");
    const body = post.postData ?? "";
    expect(body).toContain(MARKER.source);
    for (const word of [MARKER.password, MARKER.creator, MARKER.lastModifiedBy, MARKER.company, FIXTURES.secret, sha256]) {
      expect(body, `送信した本文に ${word}`).not.toContain(word);
    }
  }

  // AI 版の保存
  await openTechnicalExports(page.getByRole("tabpanel"));
  const md = await downloadBy(page, () => page.getByRole("button", { name: "AI版の仕様書(Markdown)" }).click());
  expect(md.name).toBe("顧客台帳_e2e_仕様書_AI.md");
  expect(md.text).toContain("(デモ用の固定文章)");
  expect(md.text).toContain(FIXTURES.secret);
  const html = await saveHtmlReport(page, "AI版のレポートを保存(HTML)");
  expect(html.name).toBe("顧客台帳_e2e_仕様書_AI.html");
  expect(html.text).not.toMatch(/<script/i);

  await expectNoCspViolations(page);

  // サーバーのログに、ファイル由来の文字列が出ていない(件数だけの1行ログ)
  const log = readFileSync(join(LOG_DIR, "mock.log"), "utf8");
  expect(log).toContain('"event":"ai_document"');
  expect(log).toContain('"outcome":"ok"');
  for (const word of [MARKER.source, MARKER.password, MARKER.apiKey, MARKER.email, FIXTURES.secret, "通知連携", ACCESS_CODE]) {
    expect(log, `サーバーのログに ${word}`).not.toContain(word);
  }
});

test("生成中に「中止」すると、元の結果に戻る", async ({ page }) => {
  const dialog = await openConsent(page);
  await agree(page);
  await dialog.getByRole("button", { name: SEND }).click();
  await expect(dialog.getByRole("status")).toContainText("AI版を作成しています");
  await dialog.getByRole("button", { name: "中止" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("tab", { name: "概要" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "AIによる解説" })).toHaveCount(0);
});

test("フォーム・レポートの内部のクエリも、送るものとして件数を示す", async ({ page }) => {
  await backToSelect(page);
  await analyzeFixture(page, FIXTURES.hiddenQueryAccess);
  const dialog = await openConsent(page);
  const saved = await downloadBy(page, () => dialog.getByRole("button", { name: /^送信内容を保存/ }).click());
  const queries: { hidden: boolean; sql: string | null }[] = JSON.parse(saved.text).report.access.queries;
  const hidden = queries.filter((q) => q.hidden).length;
  expect(hidden).toBeGreaterThan(0);
  const sendAsIs = dialog.locator("section", { has: page.getByRole("heading", { name: "そのまま送るもの" }) });
  await expect(sendAsIs).toContainText(`保存済みのクエリ ${queries.length - hidden} 件、フォーム・レポートの内部のクエリ ${hidden} 件`);
  await expect(sendAsIs).toContainText(`SQL ${queries.filter((q) => q.sql !== null).length} 件を含む`);
});

test.describe("スマホ幅(390px)", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });

  test("同意画面に横スクロールが出ない", async ({ page }) => {
    const dialog = await openConsent(page);
    await expectNoHorizontalScroll(page);
    const overflow = await dialog.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow, "同意画面の中に横スクロールが出ている").toBeLessThanOrEqual(0);
  });
});
