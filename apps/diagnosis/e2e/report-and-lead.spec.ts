import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { readPdf } from "../src/test-utils/pdf";
import { diagnoseKnownInput, expectInvalidWith, findLowContrastText } from "./helpers";

// 結果画面のPDFダウンロードと、無料相談の申し込み。
// E2Eのサーバーは申し込みを外部に送らず、個人情報を伏せたサーバーログに出すだけ(playwright.config.ts)。

const knownInput = {
  companyName: "テスト工業",
  industry: "製造業",
  employees: "31〜100名",
  hourlyCost: 3000,
  taskHours: { minutes: 100 },
  readiness: { dataLocation: 3, manuals: 3, aiUsage: 3, itStaff: 3, rules: 3, leadership: 3 },
  goals: [],
};

const validContact = {
  companyName: "テスト工業",
  name: "山田 太郎",
  email: "taro@example.co.jp",
  phone: "03-1234-5678",
  message: "見積書の作成をAIで効率化したい",
  consent: true,
};

function leadForm(page: Page) {
  const form = page.getByRole("form", { name: "無料相談のお申し込み" });
  return {
    form,
    companyName: form.getByRole("textbox", { name: /^会社名/ }),
    name: form.getByRole("textbox", { name: /^氏名/ }),
    email: form.getByRole("textbox", { name: /^メールアドレス/ }),
    phone: form.getByRole("textbox", { name: /^電話番号/ }),
    message: form.getByRole("textbox", { name: /^相談したい内容/ }),
    consent: form.getByRole("checkbox", { name: /個人情報の取り扱い/ }),
    submit: form.getByRole("button", { name: "無料相談を申し込む" }),
  };
}

test("結果画面からPDFをダウンロードでき、PDFとして開ける", async ({ page }) => {
  await diagnoseKnownInput(page);

  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDFをダウンロード" }).click();
  const download = await downloading;

  expect(download.suggestedFilename()).toMatch(/^AI導入診断レポート_テスト工業_\d{8}\.pdf$/);
  const bytes = await readFile(await download.path());
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");

  // PDF.js で開けて、日本語の本文が取り出せる(文字化けしていない)
  const pdf = await readPdf(new Uint8Array(bytes));
  expect(pdf.title).toBe("テスト工業様のAI導入診断レポート");
  expect(pdf.totalPages).toBeGreaterThanOrEqual(2);
  for (const expected of [
    "テスト工業様のAI導入診断レポート",
    "標準レポートです",
    "216万円",
    "業務別の年間削減見込み額",
    "議事録・報告書の作成のAI活用",
    "3ヶ月のロードマップ",
    "試算の前提",
    "試算は入力内容と一般的な目安にもとづく概算で、効果を保証するものではありません。",
  ]) {
    expect(pdf.compact).toContain(expected);
  }

  await expect(page.getByRole("status").filter({ hasText: "PDFをダウンロードしました" })).toBeVisible();
});

test("申し込みフォーム:エラーが欄に結び付き、直して送信すると完了画面になる", async ({ page }) => {
  await diagnoseKnownInput(page);
  const f = leadForm(page);

  // 会社名は診断で入力したものが入っている。プライバシーポリシーは別タブのリンク
  await expect(f.companyName).toHaveValue("テスト工業");
  const policy = f.form.getByRole("link", { name: /個人情報の取り扱い/ });
  await expect(policy).toHaveAttribute("href", "https://example.com/privacy");
  await expect(policy).toHaveAttribute("target", "_blank");
  const terms = f.form.getByRole("link", { name: /利用規約/ });
  await expect(terms).toHaveAttribute("href", "https://example.com/terms");
  await expect(terms).toHaveAttribute("target", "_blank");

  // 空のまま送ると、各欄にエラーが付き、最初のエラーの欄にフォーカスが移る
  await f.companyName.fill("");
  await f.submit.click();
  await expect(f.companyName).toBeFocused();
  await expectInvalidWith(f.companyName, "会社名を入力してください");
  await expectInvalidWith(f.name, "氏名を入力してください");
  await expectInvalidWith(f.email, "メールアドレスを入力してください");
  await expect(f.phone).not.toHaveAttribute("aria-invalid");
  await expectInvalidWith(f.message, "相談したい内容を入力してください");
  await expectInvalidWith(f.consent, /^個人情報の取り扱いへの同意が必要です/);
  expect(await findLowContrastText(page)).toEqual([]);

  // 直すとその欄のエラーは消える
  await f.companyName.fill("テスト工業");
  await expect(f.companyName).not.toHaveAttribute("aria-invalid");
  await f.name.fill(validContact.name);
  await f.message.fill(validContact.message);
  await f.consent.check();
  await expect(f.consent).not.toHaveAttribute("aria-invalid");

  // 形式の誤り
  await f.email.fill("taro@");
  await f.phone.fill("123");
  await f.submit.click();
  await expect(f.email).toBeFocused();
  await expectInvalidWith(f.email, "メールアドレスの形式が正しくありません(例:taro@example.co.jp)");
  await expectInvalidWith(f.phone, /^電話番号は数字とハイフンで入力してください/);

  await f.email.fill(validContact.email);
  await f.phone.fill(validContact.phone);
  const requesting = page.waitForRequest("**/api/lead");
  await f.submit.click();
  const request = await requesting;

  // 診断の入力を一緒に送る(結果の要約はサーバーが計算し直す)。ハニーポットは空
  const body = request.postDataJSON();
  expect(body.contact).toEqual(validContact);
  expect(body.website).toBe("");
  expect(body.input.taskHours).toEqual({ minutes: 100 });
  expect(body.input.industry).toBe("製造業");

  const done = page.getByRole("heading", { name: "お申し込みを受け付けました" });
  await expect(done).toBeVisible();
  await expect(done).toBeFocused();
  await expect(f.form).toHaveCount(0);
});

test("API:申し込みとPDFは、サーバー側でも検証し、送られた結果を信用しない", async ({ request }) => {
  // 申し込み:サーバー側の検証エラーは欄ごとに返る
  const invalid = await request.post("/api/lead", {
    data: { contact: { ...validContact, email: "taro", consent: false }, input: knownInput },
  });
  expect(invalid.status()).toBe(400);
  expect((await invalid.json()).fieldErrors).toEqual({
    email: "メールアドレスの形式が正しくありません(例:taro@example.co.jp)",
    consent: "個人情報の取り扱いへの同意が必要です",
  });

  // 申し込み:ハニーポットに入力があれば、送ったふりをする
  const bot = await request.post("/api/lead", {
    data: { contact: validContact, website: "https://spam.example", input: knownInput },
  });
  expect(bot.status()).toBe(200);

  // 申し込み:大きすぎる本文は断る
  const huge = await request.post("/api/lead", {
    data: { contact: { ...validContact, message: "あ".repeat(20_000) }, input: knownInput },
  });
  expect(huge.status()).toBe(413);

  // PDF:署名の合わないAIの文章は使わず、標準レポートで作る
  const fake = await request.post("/api/report", {
    data: {
      input: knownInput,
      report: {
        summary: "導入すれば必ず売上が倍になります。",
        recommendations: [],
        roadmap: [],
        readinessAdvice: [],
        discussionPoints: [],
      },
      reportToken: `${Date.now() + 60_000}.forged`,
    },
  });
  expect(fake.status()).toBe(200);
  expect(fake.headers()["x-report-source"]).toBe("standard");
  const pdf = await readPdf(new Uint8Array(await fake.body()));
  expect(pdf.compact).not.toContain("必ず売上が倍");
  expect(pdf.compact).toContain("216万円");
});
