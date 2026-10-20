import path from "node:path";
import { expect, test } from "@playwright/test";
import { todayJst } from "../src/lib/dates";
import { DEMO_SCENARIOS } from "../src/lib/demo/scenarios";
import { expectNoHorizontalScroll, fieldRow, findLowContrastText, SAMPLES, shown, waitForHydration } from "./helpers";

// E2Eのサーバーはデモモード(APIキーなし)とモックのSalesforceで起動する。
// 読み取り結果は合成データの固定結果、工数案は類似案件の実績からの計算になる。

const [revision, missingInfo] = DEMO_SCENARIOS;

test("引き合い登録 → 抽出結果 → 類似案件 → 見積修正 → 見積書 → Salesforce登録(モック)", async ({ page, request }) => {
  // 0. 見積待ち一覧
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("見積待ち一覧");
  await expect(page.getByText("うち8件が社長・工場長の確認待ち")).toBeVisible();
  await expect(page.getByTestId("mode")).toContainText("デモモード");
  await page.getByRole("link", { name: "新しい引き合いを登録" }).click();

  // 1. 引き合い登録:メール本文の貼り付けと図面PDF2枚のアップロード
  await expect(page).toHaveURL(/\/inquiries\/new$/);
  const email = revision.buildEmail(todayJst());
  await page.getByLabel("差出人のメールアドレス").fill(email.from);
  await page.getByLabel("件名").fill(email.subject);
  await page.getByLabel("メール本文").fill(email.body);
  await page.locator('input[type="file"]').setInputFiles(revision.drawings.map((d) => path.join(SAMPLES, d.fileName)));
  const files = page.getByRole("list", { name: "追加した図面" }).getByRole("listitem");
  await expect(files).toHaveCount(2);
  await page.getByRole("button", { name: "登録して読み取る" }).click();

  // 2. 抽出結果:値・状態・根拠(図面のどこ/メールのどの文)
  await expect(page).toHaveURL(/\/inquiries\/[0-9a-f-]{36}$/);
  const inquiryUrl = page.url();
  await expect(fieldRow(page, "材質")).toContainText("SUS304");
  await expect(fieldRow(page, "材質")).toContainText("MS-24017_C_1.pdf p.1 表題欄の材質欄");
  await expect(fieldRow(page, "数量")).toContainText("50個");
  await expect(fieldRow(page, "数量")).toContainText("メール本文 箇条書き「数量:50個」");
  await expect(fieldRow(page, "最小公差")).toContainText("±0.01 mm");
  await expect(fieldRow(page, "表面処理")).toContainText("無電解ニッケルめっき");
  await expect(fieldRow(page, "熱処理")).toContainText("不足");
  await expect(fieldRow(page, "熱処理")).toContainText("注記4「熱処理:要否は別途指示」");
  await expect(fieldRow(page, "検査書類")).toContainText("不足");
  await expect(page.getByRole("heading", { name: "顧客への確認事項(2件)" })).toBeVisible();
  // 要確認・不足の件数を表の上にまとめて出す(見落とし防止)
  await expect(page.getByText("要確認 0件・不足 2件").filter({ visible: true })).toBeVisible();
  await expect(page.getByLabel("確認メールの案(送信は担当者が行います)")).toHaveValue(/熱処理は必要でしょうか/);

  // 根拠のリンクから、登録した図面PDFを開ける
  const href = await fieldRow(page, "材質").getByRole("link", { name: "MS-24017_C_1.pdf p.1" }).getAttribute("href");
  const pdf = await request.get(href!);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  expect(await findLowContrastText(page)).toEqual([]);

  // 3. 類似案件:同じ図番の旧版が1位で、赤字の警告と根拠が出る
  await page.getByRole("button", { name: "類似案件を検索して工数案を作る" }).click();
  await expect(page).toHaveURL(/\/similar$/);
  const cases = page.getByRole("list", { name: "類似案件" }).getByRole("listitem").filter({ has: page.getByRole("heading") });
  await expect(cases).toHaveCount(5);
  const first = cases.first();
  await expect(first.getByRole("heading")).toHaveText("センサブラケット MS-24017 Rev.B");
  await expect(first).toContainText("同じ図番の旧版(Rev.B)");
  await expect(first).toContainText("見積工数1.2時間に対し実績1.6時間");
  await expect(first).toContainText("赤字の可能性");
  await expect(cases.nth(1)).toContainText("材質が同じ(SUS304)");
  expect(await findLowContrastText(page)).toEqual([]);
  await page.getByRole("link", { name: "見積根拠へ進む" }).click();

  // 4. 見積根拠:工数を直すと即座に再計算され、出典が「人が修正」になる
  await expect(page).toHaveURL(/\/quote$/);
  const lines = page.getByRole("table", { name: "見積明細" });
  const total = shown(page, "quote-total");
  const before = await total.textContent();
  const mcRow = page.getByRole("table", { name: "工程別の工数" }).getByRole("row", { name: /^マシニング加工/ });
  await expect(mcRow).toContainText("類似実績から計算");
  await page.getByRole("spinbutton", { name: "マシニング加工の1個あたり加工時間(時間)" }).fill("1.2");
  // 1.2h × 数量係数0.9 × 50個 × 8,000円/h = 432,000円
  const mcLine = lines.getByRole("row", { name: /^加工費\(マシニング加工\)/ });
  await expect(mcLine).toContainText("1.2h × 数量係数0.9 × 50個 × 8,000円/h");
  await expect(mcLine).toContainText("432,000円");
  await expect(total).not.toHaveText(before!);
  await expect(mcRow).toContainText("人が修正");
  await expect(page.getByText("未保存の修正があります").filter({ visible: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "見積の合計" })).toContainText((await total.textContent())!);
  // 根拠の確認ポイント(旧版の赤字・前提条件)
  await expect(page.getByText("類似案件 Q-").first()).toBeVisible();
  await expect(page.getByText("熱処理の要否が未確定のため、熱処理なしで計算しています")).toBeVisible();
  const quotedTotal = (await total.textContent())!;
  expect(await findLowContrastText(page)).toEqual([]);

  // 数量を消すと誤りを知らせ、金額は前の値のまま、保存も承認もできない
  const approveButton = page.getByRole("button", { name: "この内容で承認して見積書へ" });
  const quantity = page.getByRole("spinbutton", { name: "数量(個)" });
  await quantity.fill("");
  await expect(page.getByRole("alert").filter({ hasText: "入力に誤りがある欄があります(数量)" })).toBeVisible();
  await expect(total).toHaveText(quotedTotal);
  await expect(page.getByRole("button", { name: "修正を保存" })).toBeDisabled();
  await quantity.fill("50");
  await expect(page.getByRole("alert").filter({ hasText: "入力に誤りがある欄があります" })).toHaveCount(0);

  // 抽出結果の未確認の項目(熱処理・検査書類が不足)を確認するまで承認できない
  await expect(page.getByRole("list", { name: "未確認の項目" }).filter({ visible: true })).toContainText("熱処理:不足");
  await expect(approveButton).toBeDisabled();
  await page.getByRole("checkbox", { name: "未確認の項目(2件)を確認したうえで承認する" }).check();
  await approveButton.click();

  // 5. 見積書:承認した金額(税抜)と、回答メール案
  await expect(page).toHaveURL(/\/document$/);
  const doc = page.getByRole("article", { name: "見積書" });
  await expect(doc.getByRole("heading", { level: 2 })).toHaveText("御見積書");
  await expect(doc).toContainText("ミナモト装置工業株式会社 御中");
  await expect(shown(page, "document-subtotal")).toHaveText(quotedTotal);
  await expect(doc).toContainText("承認:代表取締役 白石");
  await expect(page.getByLabel("回答メールの案")).toHaveValue(/見積番号:QA-\d{8}-[0-9A-F]{4}/);
  await expect(shown(page, "inquiry-status")).toHaveText("承認済み");
  await page.getByRole("link", { name: "Salesforceに登録する" }).click();

  // 6. Salesforce登録(モック):登録内容の確認 → 登録 → 計測と修正の記録
  await expect(page).toHaveURL(/\/crm$/);
  await expect(page.getByText("Amount")).toBeVisible();
  await expect(page.getByText("@{opportunity.id}")).toBeVisible();
  await page.getByRole("button", { name: "Salesforce(モック)に商談と見積を登録" }).click();
  await expect(shown(page, "crm-result")).toContainText("商談 006MK0000000001AAA");
  await expect(shown(page, "inquiry-status")).toHaveText("CRM登録済み");
  await expect(page.getByRole("table", { name: "処理ステップごとの計測" }).getByRole("row")).toHaveCount(6);
  await expect(page.getByRole("region", { name: "計測の合計" })).toContainText("AIのトークン数");
  const log = page.getByRole("table", { name: "修正の記録" });
  await expect(log.getByRole("row", { name: /マシニング加工の1個あたり時間/ })).toContainText("1.2");
  await expect(log.getByRole("row", { name: /承認/ })).toContainText("代表取締役 白石");
  await expect(log.getByRole("row", { name: /未確認のまま進めた抽出項目/ })).toContainText("熱処理");

  // 二重登録はできない
  const id = inquiryUrl.split("/").pop();
  const again = await request.post(`/api/inquiries/${id}/crm`);
  expect(again.status()).toBe(409);

  // モックのSalesforce画面に商談と見積ができている
  await page.getByRole("link", { name: "登録した商談を開く" }).click();
  const record = page.getByRole("list", { name: "登録された商談" }).getByRole("listitem").first();
  await expect(record.getByRole("heading")).toHaveText("ミナモト装置工業 センサブラケット MS-24017 Rev.C ×50");
  await expect(record).toContainText(quotedTotal);
  await expect(record).toContainText("001MK00000000000C01");

  // 一覧に処理結果が出る
  await page.goto("/");
  const row = page.getByRole("row", { name: /センサブラケット MS-24017/ });
  await expect(row).toContainText("CRM登録済み");
  await expect(row).toContainText(quotedTotal);
});

test("情報不足の引き合い:確認事項を出し、人が修正すると確認事項が減る。承認前はCRMに登録できない", async ({ page, request }) => {
  await page.goto("/inquiries/new");
  await page.getByRole("button", { name: `${missingInfo.label}を読み込む` }).click();
  await expect(page.getByRole("list", { name: "追加した図面" }).getByRole("listitem")).toHaveCount(1);
  await expect(page.getByLabel("メール本文")).toHaveValue(/数は試作なので数個です/);
  await page.getByRole("button", { name: "登録して読み取る" }).click();

  await expect(page).toHaveURL(/\/inquiries\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "顧客への確認事項(5件)" })).toBeVisible();
  await expect(fieldRow(page, "顧客")).toContainText("顧客マスタに該当なし・新規");
  await expect(fieldRow(page, "材質")).toContainText("アルミ系");
  await expect(fieldRow(page, "数量")).toContainText("不足");
  await expect(fieldRow(page, "表面処理")).toContainText("種類が決まっていません");

  // 人が材質と数量を確定する
  await page.getByRole("button", { name: "抽出内容を修正する" }).click();
  await page.getByLabel("材質").selectOption("A5052");
  await page.getByLabel("数量(個)").fill("3");
  await page.getByRole("button", { name: "保存して再チェック" }).click();
  await expect(page.getByRole("heading", { name: "顧客への確認事項(3件)" })).toBeVisible();
  await expect(fieldRow(page, "材質")).toContainText("人が修正");
  await expect(fieldRow(page, "数量")).toContainText("3個");

  await page.getByRole("button", { name: "類似案件を検索して工数案を作る" }).click();
  await expect(page).toHaveURL(/\/similar$/);
  await page.getByRole("link", { name: "見積根拠へ進む" }).click();
  await expect(page.getByText("表面処理の種類が未確定のため 白アルマイト で仮計算しています")).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "数量(個)" })).toHaveValue("3");

  // 承認前のCRM登録は断られる
  const id = page.url().split("/").at(-2);
  const res = await request.post(`/api/inquiries/${id}/crm`);
  expect(res.status()).toBe(409);
  expect((await res.json()).error).toContain("承認されていません");
  await page.goto(`/inquiries/${id}/crm`);
  await expect(page.getByText("見積が承認されていません")).toBeVisible();
});

test("PDF以外のファイルと空の登録は受け付けない", async ({ page, request }) => {
  await page.goto("/inquiries/new");
  await waitForHydration(page, "登録して読み取る");
  await page.locator('input[type="file"]').setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: Buffer.from("not a pdf") });
  await expect(page.locator("form").getByRole("alert")).toHaveText("PDF(1ファイル10MBまで)だけを追加できます");
  await page.getByRole("button", { name: "登録して読み取る" }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("メール本文を貼り付けるか、図面PDFを追加してください");

  // 拡張子だけPDFにした偽物はサーバーで断る
  const res = await request.post("/api/inquiries", {
    multipart: { body: "見積お願いします", files: { name: "fake.pdf", mimeType: "application/pdf", buffer: Buffer.from("hello") } },
  });
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toContain("PDFではないファイル");
});

test.describe("スマホ幅(390px)とダークモード", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "dark" });

  test("登録・抽出結果・見積根拠の画面で横スクロールが出ず、文字が読める", async ({ page }) => {
    await page.goto("/inquiries/new");
    await expectNoHorizontalScroll(page);
    await page.getByRole("button", { name: /サンプル3/ }).click();
    await expect(page.getByRole("list", { name: "追加した図面" }).getByRole("listitem")).toHaveCount(1);
    await page.getByRole("button", { name: "登録して読み取る" }).click();
    await expect(page).toHaveURL(/\/inquiries\/[0-9a-f-]{36}$/);
    await expect(fieldRow(page, "熱処理")).toContainText("高周波焼入れ");
    await expectNoHorizontalScroll(page);
    expect(await findLowContrastText(page)).toEqual([]);

    await page.getByRole("button", { name: "類似案件を検索して工数案を作る" }).click();
    await expect(page).toHaveURL(/\/similar$/);
    await expectNoHorizontalScroll(page);
    await page.getByRole("link", { name: "見積根拠へ進む" }).click();
    // 短納期なので特急料金を計上し、旧版にある円筒研削も工数案に入る
    await expect(page.getByRole("checkbox", { name: /特急料金を計上する/ })).toBeChecked();
    await expect(page.getByRole("table", { name: "見積明細" }).getByRole("row", { name: /^特急料金/ })).toBeVisible();
    await expect(page.getByRole("table", { name: "工程別の工数" }).getByRole("row", { name: /^円筒研削/ })).toBeVisible();
    await expectNoHorizontalScroll(page);
    expect(await findLowContrastText(page)).toEqual([]);
  });

  test("未確認の項目の一覧と承認の確認も、スマホ幅で読めてキーボードで操作できる", async ({ page }) => {
    await page.goto("/inquiries/new");
    await page.getByRole("button", { name: /サンプル1/ }).click();
    await expect(page.getByRole("list", { name: "追加した図面" }).getByRole("listitem")).toHaveCount(2);
    await page.getByRole("button", { name: "登録して読み取る" }).click();
    await expect(page).toHaveURL(/\/inquiries\/[0-9a-f-]{36}$/);
    await expect(page.getByText("要確認 0件・不足 2件").filter({ visible: true })).toBeVisible();
    await expectNoHorizontalScroll(page);
    expect(await findLowContrastText(page)).toEqual([]);

    await page.getByRole("button", { name: "類似案件を検索して工数案を作る" }).click();
    await expect(page).toHaveURL(/\/similar$/);
    await page.getByRole("link", { name: "見積根拠へ進む" }).click();
    await expect(page.getByRole("list", { name: "未確認の項目" }).filter({ visible: true })).toContainText("検査書類:不足");
    await expectNoHorizontalScroll(page);
    expect(await findLowContrastText(page)).toEqual([]);

    // チェックボックスはキーボード(スペース)で入れられ、入れると承認ボタンが押せる
    const approve = page.getByRole("button", { name: "この内容で承認して見積書へ" });
    await expect(approve).toBeDisabled();
    const ack = page.getByRole("checkbox", { name: /未確認の項目.*を確認したうえで承認する/ });
    await ack.focus();
    await page.keyboard.press("Space");
    await expect(ack).toBeChecked();
    await expect(approve).toBeEnabled();
  });
});
