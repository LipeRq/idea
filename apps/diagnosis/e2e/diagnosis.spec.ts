import { expect, test, type Page } from "@playwright/test";
import {
  answerAllReadiness,
  backButton,
  currentStep,
  employeesSelect,
  expectInvalidWith,
  expectNoHorizontalScroll,
  fillCompanyStep,
  fillHoursStep,
  findLowContrastText,
  formAlert,
  goalCheckbox,
  hourlyCostInput,
  hoursInput,
  industrySelect,
  nextButton,
  readinessRadio,
  submitAndWaitForResult,
} from "./helpers";

// E2Eのサーバーは APIキーなしで起動するので、結果は標準レポート(決まった文面と数値)になる。
// 回数制限の上限は playwright.config.ts で緩めている。

const company = {
  companyName: "テスト工業",
  industry: "製造業",
  employees: "31〜100名",
  goals: ["人手不足への対応"],
  challenges: "見積の作成がベテラン1人に集中している",
};

function region(page: Page, name: string) {
  return page.getByRole("region", { name });
}

function statTile(page: Page, label: string) {
  return page.locator("div.rounded-xl", { has: page.getByText(label, { exact: true }) });
}

test("自由記述欄に外部のAIへの送信と注意が結び付き、フッターに利用規約・プライバシーポリシーのリンクが出る", async ({
  page,
}) => {
  await page.goto("/");
  const challenges = page.getByLabel("いま困っていること(任意)");
  await expect(challenges).toHaveAccessibleDescription(/Anthropic 社\(米国\)に送信します/);
  await expect(challenges).toHaveAccessibleDescription(/個人情報\(氏名・連絡先など\)や機密情報は書かないでください/);
  const note = page.locator("#diagnosis-challenges-note");
  await expect(note.getByRole("link", { name: /プライバシーポリシー/ })).toHaveAttribute(
    "href",
    "https://example.com/privacy",
  );

  // フッターは main の中にあるので contentinfo の役割を持たない
  const footer = page.locator("footer");
  await expect(footer.getByRole("link", { name: "利用規約" })).toHaveAttribute("href", "https://example.com/terms");
  await expect(footer.getByRole("link", { name: "プライバシーポリシー" })).toHaveAttribute(
    "href",
    "https://example.com/privacy",
  );
});

test("ステップごとの入力チェック、戻る/次へで入力が残る", async ({ page }) => {
  await page.goto("/");
  await expect(currentStep(page)).toContainText("会社情報");

  // 優先したいこと(見た目はチップ)にキーボードで移ると、チップにフォーカス枠が出る
  await page.getByLabel("会社名(任意)").focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("Tab");
  await expect(goalCheckbox(page, "コスト削減")).toBeFocused();
  const chip = page.locator("label", { has: goalCheckbox(page, "コスト削減") });
  await expect(chip).toHaveCSS("outline-style", "solid");
  await expect(chip).toHaveCSS("outline-width", "2px");
  await page.keyboard.press("Space");
  await expect(goalCheckbox(page, "コスト削減")).toBeChecked();
  await page.keyboard.press("Space");
  await expect(goalCheckbox(page, "コスト削減")).not.toBeChecked();

  // ステップ1:業種・従業員規模は必須。エラーは該当する欄に結び付く
  await nextButton(page).click();
  await expect(formAlert(page)).toHaveText("業種を選んでください");
  await expectInvalidWith(industrySelect(page), "業種を選んでください");
  await expect(employeesSelect(page)).not.toHaveAttribute("aria-invalid");
  await industrySelect(page).selectOption("製造業");
  await nextButton(page).click();
  await expect(formAlert(page)).toHaveText("従業員規模を選んでください");
  await expect(industrySelect(page)).not.toHaveAttribute("aria-invalid");
  await expectInvalidWith(employeesSelect(page), "従業員規模を選んでください");
  await fillCompanyStep(page, company);
  await nextButton(page).click();

  // ステップ2:エラーは消え、最初の入力欄にフォーカスが移る
  await expect(currentStep(page)).toContainText("業務にかかる時間");
  await expect(formAlert(page)).toHaveCount(0);
  await expect(hoursInput(page, "inquiry")).toBeFocused();

  await nextButton(page).click();
  await expect(formAlert(page)).toHaveText("少なくとも1つの業務に時間を入力してください");

  await hourlyCostInput(page).fill("");
  await nextButton(page).click();
  await expect(formAlert(page)).toHaveText("平均人件費は1,000〜20,000円の整数で入力してください");
  await hourlyCostInput(page).fill("999");
  await nextButton(page).click();
  await expect(formAlert(page)).toHaveText("平均人件費は1,000〜20,000円の整数で入力してください");
  await hourlyCostInput(page).fill("3000");

  await hoursInput(page, "minutes").fill("-5");
  await nextButton(page).click();
  await expect(formAlert(page)).toHaveText("時間は0〜10,000の数字で入力してください");
  // 範囲外の欄だけがエラーになる
  await expectInvalidWith(hoursInput(page, "minutes"), "時間は0〜10,000の数字で入力してください");
  await expect(hoursInput(page, "inquiry")).not.toHaveAttribute("aria-invalid");
  await hoursInput(page, "minutes").fill("10001");
  await nextButton(page).click();
  await expect(formAlert(page)).toHaveText("時間は0〜10,000の数字で入力してください");
  await hoursInput(page, "minutes").fill("100");
  await nextButton(page).click();

  // ステップ3:すべての項目に回答が必要
  await expect(currentStep(page)).toContainText("IT環境");
  await expect(readinessRadio(page, 0, 0)).toBeFocused();
  await page.getByRole("button", { name: "診断する" }).click();
  await expect(formAlert(page)).toHaveText("すべての項目に回答してください");
  for (let i = 0; i < 5; i++) await readinessRadio(page, i, 2).check();
  await page.getByRole("button", { name: "診断する" }).click();
  await expect(formAlert(page)).toHaveText("すべての項目に回答してください");
  // 未回答の項目(6問目)の選択肢だけがエラーになる
  await expectInvalidWith(readinessRadio(page, 5, 0), "すべての項目に回答してください");
  await expect(readinessRadio(page, 0, 0)).not.toHaveAttribute("aria-invalid");

  // 戻ると、エラーは消え、入力した内容が残っている
  await backButton(page).click();
  await expect(currentStep(page)).toContainText("業務にかかる時間");
  await expect(formAlert(page)).toHaveCount(0);
  await expect(hoursInput(page, "minutes")).toHaveValue("100");
  await expect(hourlyCostInput(page)).toHaveValue("3000");

  await backButton(page).click();
  await expect(currentStep(page)).toContainText("会社情報");
  await expect(backButton(page)).toHaveCount(0);
  // 押した「戻る」ボタンが消えても、フォーカスは最初の入力欄に移る
  await expect(page.getByLabel("会社名(任意)")).toBeFocused();
  await expect(page.getByLabel("会社名(任意)")).toHaveValue("テスト工業");
  await expect(industrySelect(page)).toHaveValue("製造業");
  await expect(employeesSelect(page)).toHaveValue("31〜100名");
  await expect(goalCheckbox(page, "人手不足への対応")).toBeChecked();
  await expect(goalCheckbox(page, "コスト削減")).not.toBeChecked();
  await expect(page.getByLabel("いま困っていること(任意)")).toHaveValue(company.challenges);

  await nextButton(page).click();
  await nextButton(page).click();
  await expect(currentStep(page)).toContainText("IT環境");
  for (let i = 0; i < 5; i++) await expect(readinessRadio(page, i, 2)).toBeChecked();
  await expect(readinessRadio(page, 5, 2)).not.toBeChecked();
});

test("既知の入力で主要な数値が出て、グラフのフォーカスでツールチップ、再診断で入力が残る", async ({
  page,
}) => {
  await page.goto("/");
  await fillCompanyStep(page, company);
  await nextButton(page).click();
  await fillHoursStep(page, { minutes: 100 }, 3000);
  await nextButton(page).click();
  await answerAllReadiness(page, 3);
  await submitAndWaitForResult(page);

  // 結果の見出しにフォーカスが移る(押したボタンが消えるため)
  const heading = page.getByRole("heading", { level: 2 });
  await expect(heading).toHaveText("テスト工業様のAI導入診断レポート");
  await expect(heading).toBeFocused();
  await expect(page.getByText("標準レポートです(AIによる個別分析は行っていません)")).toBeVisible();

  // 議事録100時間 × 削減率60% × 実現係数1.0(準備度100点)= 月60時間、年720時間、×3,000円 = 216万円
  const hero = region(page, "年間の削減見込み額");
  await expect(hero).toContainText("216万円");
  await expect(hero).toContainText("年間 約720時間");
  await expect(hero).toContainText("月100時間");
  await expect(statTile(page, "AI導入の準備度")).toContainText("100点");
  await expect(statTile(page, "AI導入の準備度")).toContainText("推進段階");
  await expect(statTile(page, "優先施策の初期費用(目安)")).toContainText("10万円");
  await expect(statTile(page, "優先施策の年間運用費(目安)")).toContainText("12万円");

  const rec = page.locator("li", { hasText: "優先度 1" });
  await expect(rec.getByRole("heading", { level: 4 })).toHaveText("議事録・報告書の作成のAI活用");
  await expect(rec.locator("dd")).toHaveText(["60時間", "216万円", "低", "約1ヶ月"]);

  const row = page.getByRole("row", { name: /議事録・報告書の作成/ });
  await expect(row.getByRole("cell")).toHaveText([
    "議事録・報告書の作成",
    "100時間",
    "60%",
    "60時間",
    "216万円",
    "低",
  ]);
  await expect(page.getByText(/実現係数\(1。/)).toBeVisible();

  // 標準レポートの総評も画面と同じ数値
  await expect(page.getByText(/月間合計100時間のうち.*年間約720時間\(約216万円\)/)).toBeVisible();

  // グラフ:棒にフォーカスするとツールチップが出て、外すと消える
  const bar = page.getByRole("img", { name: /^議事録・報告書の作成: 年間216万円/ });
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await bar.focus();
  await expect(page.getByRole("tooltip")).toHaveText("月 60時間 の削減(現在 月100時間)");
  await bar.blur();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  // キーボードの Tab でも同じ
  await heading.focus();
  for (let i = 0; i < 10 && !(await bar.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press("Tab");
  }
  await expect(bar).toBeFocused();
  await expect(page.getByRole("tooltip")).toBeVisible();

  // ライトモードでも文字のコントラストが足りている
  expect(await findLowContrastText(page)).toEqual([]);

  // 再診断:入力内容が残っている
  await page.getByRole("button", { name: "入力内容を修正して再診断" }).click();
  await expect(currentStep(page)).toContainText("会社情報");
  await expect(page.getByLabel("会社名(任意)")).toBeFocused();
  await expect(page.getByLabel("会社名(任意)")).toHaveValue("テスト工業");
  await expect(industrySelect(page)).toHaveValue("製造業");
  await expect(employeesSelect(page)).toHaveValue("31〜100名");
  await expect(goalCheckbox(page, "人手不足への対応")).toBeChecked();
  await expect(page.getByLabel("いま困っていること(任意)")).toHaveValue(company.challenges);
  await nextButton(page).click();
  await expect(hoursInput(page, "minutes")).toHaveValue("100");
  await expect(hourlyCostInput(page)).toHaveValue("3000");
  await fillHoursStep(page, { inquiry: 50 });
  await nextButton(page).click();
  for (let i = 0; i < 6; i++) await expect(readinessRadio(page, i, 3)).toBeChecked();

  // 準備度をすべて2段階目(1点)に下げて再診断 → 33点、実現係数0.665
  // 議事録 100×0.6×0.665 = 月39.9時間(年144万円)、問い合わせ 50×0.4×0.665 = 月13.3時間(年48万円)
  await answerAllReadiness(page, 1);
  await submitAndWaitForResult(page);
  await expect(hero).toContainText("192万円");
  await expect(hero).toContainText("年間 約638時間");
  await expect(hero).toContainText("月150時間");
  await expect(statTile(page, "AI導入の準備度")).toContainText("33点");
  await expect(statTile(page, "AI導入の準備度")).toContainText("準備段階");
  await expect(page.getByText(/実現係数\(0\.665。/)).toBeVisible();
  await expect(page.getByRole("row", { name: /議事録・報告書の作成/ }).getByRole("cell")).toHaveText([
    "議事録・報告書の作成",
    "100時間",
    "60%",
    "39.9時間",
    "144万円",
    "低",
  ]);
  await expect(page.getByRole("row", { name: /問い合わせ・メール対応/ }).getByRole("cell")).toHaveText([
    "問い合わせ・メール対応",
    "50時間",
    "40%",
    "13.3時間",
    "48万円",
    "低",
  ]);
});

test.describe("スマホ幅(390px)", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("どのステップと結果画面でも横スクロールが出ない", async ({ page }) => {
    await page.goto("/");
    await expectNoHorizontalScroll(page);

    // 英字だけの長い会社名でもはみ出さない
    await fillCompanyStep(page, {
      ...company,
      companyName: "ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ",
      goals: ["コスト削減", "人手不足への対応", "売上・受注の拡大", "属人化の解消", "品質向上・ミス削減"],
    });
    await expectNoHorizontalScroll(page);
    await nextButton(page).click();

    await fillHoursStep(
      page,
      {
        inquiry: 10_000,
        documents: 10_000,
        minutes: 10_000,
        dataEntry: 10_000,
        accounting: 10_000,
        internalHelpdesk: 10_000,
        search: 10_000,
        reporting: 10_000,
        salesResearch: 10_000,
        manual: 10_000,
      },
      20_000,
    );
    await expectNoHorizontalScroll(page);
    await nextButton(page).click();

    await answerAllReadiness(page, 0);
    await expectNoHorizontalScroll(page);
    await submitAndWaitForResult(page);

    // 上限いっぱいの入力(金額が「億円」の桁)でも崩れない
    await expect(region(page, "年間の削減見込み額")).toContainText("億円");
    await expectNoHorizontalScroll(page);

    // ツールチップを出してもはみ出さない
    const bars = page.getByRole("img", { name: /年間.*の削減見込み/ });
    await expect(bars).toHaveCount(10);
    for (const i of [0, 9]) {
      await bars.nth(i).focus();
      await expect(page.getByRole("tooltip")).toBeVisible();
      await expectNoHorizontalScroll(page);
    }

    // 表は枠の中で横にスクロールする(ページ全体はスクロールしない)
    const tableBox = page.locator("table").locator("xpath=..");
    expect(await tableBox.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  });
});

test.describe("ダークモード", () => {
  test.use({ colorScheme: "dark" });

  test("入力画面と結果画面がダークの配色で表示され、文字が読める", async ({ page }, testInfo) => {
    await page.goto("/");

    const colors = await page.evaluate(() => {
      const bg = (sel: string) => getComputedStyle(document.querySelector(sel)!).backgroundColor;
      return {
        body: bg("body"),
        form: bg("form"),
        select: bg("select"),
        text: getComputedStyle(document.querySelector("h1")!).color,
      };
    });
    expect(colors).toEqual({
      body: "rgb(13, 13, 13)",
      form: "rgb(26, 26, 25)",
      select: "rgb(26, 26, 25)",
      text: "rgb(240, 239, 236)",
    });
    expect(await findLowContrastText(page)).toEqual([]);

    // エラー表示も読める
    await nextButton(page).click();
    await expect(formAlert(page)).toBeVisible();
    expect(await findLowContrastText(page, "form")).toEqual([]);

    await fillCompanyStep(page, company);
    await nextButton(page).click();
    await fillHoursStep(page, {
      inquiry: 80,
      documents: 60,
      minutes: 40,
      dataEntry: 120,
      search: 50,
      reporting: 30,
    });
    expect(await findLowContrastText(page)).toEqual([]);
    await nextButton(page).click();
    await answerAllReadiness(page, 1);
    expect(await findLowContrastText(page)).toEqual([]);
    await submitAndWaitForResult(page);

    await expect(region(page, "年間の削減見込み額")).toContainText("420万円");
    expect(await findLowContrastText(page)).toEqual([]);
    await expectNoHorizontalScroll(page);

    // グラフの棒がカードの背景から見分けられる(3:1以上)
    const bar = page.getByRole("img", { name: /^データ入力・転記/ });
    await bar.focus();
    await expect(page.getByRole("tooltip")).toBeVisible();
    expect(await findLowContrastText(page)).toEqual([]);
    const barContrast = await bar.evaluate((el) => {
      const toRgb = (s: string) => s.match(/\d+/g)!.slice(0, 3).map(Number);
      const lum = (c: number[]) => {
        const [r, g, b] = c.map((v) => {
          const x = v / 255;
          return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const fill = lum(toRgb(getComputedStyle(el.firstElementChild!).backgroundColor));
      const card = lum(toRgb(getComputedStyle(el.closest("section")!).backgroundColor));
      const [hi, lo] = [fill, card].sort((a, b) => b - a);
      return (hi + 0.05) / (lo + 0.05);
    });
    expect(barContrast).toBeGreaterThanOrEqual(3);

    await testInfo.attach("result-dark", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  });
});
