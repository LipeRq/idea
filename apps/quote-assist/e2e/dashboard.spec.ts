import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, findLowContrastText, shown } from "./helpers";

// 効果測定ダッシュボード。E2Eのサーバーはデモモードで、参照データに合成データ(架空のベースラインと導入後の記録)がある。
// 数字は scripts/lib/impact.ts の固定の種から決まる(変えたら、この値と README・デモ台本を合わせて更新する)。

function chart(page: Page, id: string) {
  // 画面遷移のあと、前の画面が非表示のまま残るので、表示中のものだけにする
  return shown(page, `trend-${id}`);
}

test("ダッシュボード:導入前後の比較、参考値、定義と計算式、週・月の切り替え", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("効果測定ダッシュボード");
  // 導入前・導入後のデータの出どころ(架空)と件数
  const context = page.getByTestId("impact-context");
  await expect(context).toContainText("デモ用の架空のベースライン");
  await expect(context).toContainText("40件");
  await expect(context).toContainText("デモ用の架空の記録(しらかば精工)");
  await expect(context).toContainText("60件");

  // 指標:導入後の値と導入前との差。効果は断定せず「方向」で示す
  const lead = page.getByTestId("kpi-leadTime");
  await expect(lead).toContainText("3営業日");
  await expect(lead).toContainText("導入前 4営業日");
  await expect(lead).toContainText("導入前より良い方向");
  await expect(page.getByTestId("kpi-workMinutes")).toContainText("41分");
  await expect(page.getByTestId("kpi-nonEstimator")).toContainText("33%");
  await expect(page.getByTestId("kpi-adoption")).toContainText("87%");
  await expect(page.getByTestId("kpi-winRate")).toContainText("導入前より悪い方向");
  await expect(page.getByTestId("kpi-aiCost")).toContainText("144円");
  // データが少ない値は「参考値」(件数9件)。良し悪しは判断しない
  const deficit = page.getByTestId("kpi-deficit");
  await expect(deficit).toContainText("参考値");
  await expect(deficit).toContainText("参考値のため、良し悪しは判断しません");

  const table = page.getByRole("table", { name: "導入前後の比較" });
  await expect(table.getByTestId("row-leadTime")).toContainText("4営業日");
  await expect(table.getByTestId("row-leadTime")).toContainText("38 / 55");
  await expect(table.getByTestId("row-aiCost")).toContainText("対象なし");
  await expect(table.getByTestId("row-deficit")).toContainText("11%(参考値)");

  // 定義と計算式・注意の文言
  const defs = page.getByTestId("definitions");
  await expect(defs).toContainText("営業日数(受付日 → 回答日)");
  await expect(defs).toContainText("実績原価 > 受注額の件数 ÷ 実績原価と受注額がある受注件数");
  await expect(page.getByText("差のすべてを見積アシストの効果とは断定できません")).toBeVisible();

  // 期間:週ごと(既定)→ 月ごと。グラフの表(表で見る)に期間が並ぶ
  await expect(page.getByRole("link", { name: "週ごと" })).toHaveAttribute("aria-current", "true");
  await chart(page, "leadTime").getByText("表で見る").click();
  const weekly = chart(page, "leadTime").getByRole("table");
  await expect(weekly.getByRole("row")).toHaveCount(1 + 6 + 1); // 見出し+6週+導入前
  await expect(weekly).toContainText("9月7日の週");
  await expect(weekly).toContainText("参考値"); // 週ごとの件数は10件未満の週がある

  await page.getByRole("link", { name: "月ごと" }).click();
  await expect(page).toHaveURL(/g=month/);
  await expect(page.getByRole("link", { name: "月ごと" })).toHaveAttribute("aria-current", "true");
  // 同じ部品が使い回されるので、前に開いた表は開いたまま
  const details = chart(page, "leadTime").locator("details");
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) await details.getByText("表で見る").click();
  const monthly = chart(page, "leadTime").getByRole("table");
  await expect(monthly.getByRole("row")).toHaveCount(1 + 2 + 1);
  await expect(monthly).toContainText("2026年9月");
  await expect(monthly).toContainText("2026年10月");
  // 月ごとにしても、上の導入前後の比較は同じ(期間の単位は推移だけに効く)
  await expect(page.getByTestId("kpi-leadTime")).toContainText("3営業日");

  expect(await findLowContrastText(page)).toEqual([]);
});

test("グラフ:ホバーとキーボードで値(件数・参考値・導入前)が読める。項目別の採用率も", async ({ page }) => {
  await page.goto("/dashboard");
  const lead = chart(page, "leadTime");
  const plot = lead.getByRole("group", { name: /のグラフ/ });
  await plot.hover({ position: { x: 200, y: 80 } });
  await expect(lead.getByText("値に使えた件数")).toBeVisible();
  await expect(lead.getByText(/導入前 4営業日/).first()).toBeVisible();

  // キーボード:フォーカスすると最後の期間、左右の矢印で動く。読み上げ用の文にも値が出る
  await page.mouse.move(0, 0);
  await plot.focus();
  const live = lead.locator("p[aria-live=polite]");
  await expect(live).toContainText("10月12日の週");
  await expect(live).toContainText("参考値"); // 直近の週は回答が少ない
  await page.keyboard.press("ArrowLeft");
  await expect(live).toContainText("10月5日の週");
  await page.keyboard.press("Home");
  await expect(live).toContainText("9月7日の週");

  // 項目別の採用率:棒にホバーすると、採用率・修正率・件数
  const bars = page.getByTestId("adoption-bars");
  const row = bars.getByRole("listitem").filter({ hasText: "利益率" });
  await row.hover();
  await expect(bars.getByText("評価 55件・修正")).toBeVisible();
  // 採用率の低い項目が上(修正されやすい項目)
  await expect(bars.locator("li[tabindex='0']").first()).toContainText("検査書類");
});

test("書き出し:CSV(導入前後・推移・項目別)とMarkdown", async ({ request }) => {
  const summary = await request.get("/api/impact/export?format=csv&part=summary");
  expect(summary.headers()["content-type"]).toContain("text/csv");
  expect(summary.headers()["content-disposition"]).toMatch(/attachment; filename="quote-assist-impact-summary-\d{4}-\d{2}-\d{2}\.csv"/);
  const csv = await summary.text();
  expect(csv.charCodeAt(0)).toBe(0xfeff); // Excelで文字化けしないBOM
  expect(csv).toContain("見積回答リードタイム,営業日,4,38,");
  expect(csv).toContain("参考値");
  expect(csv).toContain("計算式");

  const trend = await (await request.get("/api/impact/export?format=csv&part=trend&g=month")).text();
  expect(trend).toContain("2026年9月");
  expect(trend).toContain("2026年10月");

  const adoption = await (await request.get("/api/impact/export?format=csv&part=adoption")).text();
  expect(adoption).toContain("利益率");

  const md = await (await request.get("/api/impact/export?format=md")).text();
  expect(md).toContain("# 見積アシスト 効果測定レポート(試験導入期間の実測値)");
  expect(md).toContain("## 1. 導入前後の比較");
  expect(md).toContain("| 速さ | 見積回答リードタイム | 4営業日 | 3営業日 |");
  expect(md).toContain("11%(参考値)");
  expect(md).toContain("## 4. 指標の定義と計算式");
  expect(md).toContain("断定しません");
});

test("報告書:印刷向けの表示(操作ボタンを隠し、表が用紙の幅に収まる)", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "報告書を開く(印刷・PDF)" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("効果測定の報告書(試験導入期間の実測値)");
  const report = page.getByTestId("impact-report");
  await expect(report).toContainText("1. 導入前後の比較");
  await expect(report).toContainText("4. 指標の定義と計算式");
  await expect(report.getByRole("button", { name: "印刷・PDFで保存" })).toBeVisible();

  // 印刷(A4の幅に近い画面)では、ボタンを隠し、横スクロールもしない
  await page.setViewportSize({ width: 700, height: 1000 });
  await page.emulateMedia({ media: "print" });
  await expect(report.getByRole("button", { name: "印刷・PDFで保存" })).toBeHidden();
  await expect(report.getByRole("link", { name: "ダッシュボードに戻る" })).toBeHidden();
  await expectNoHorizontalScroll(page);
  await expect(report.getByRole("table", { name: "導入前後の比較" })).toBeVisible();
});

test("ベースライン:CSVの取り込み(誤りの行は知らせる)・1件ずつの入力・保存 → 導入前の値に反映", async ({ page, request }) => {
  await page.goto("/dashboard/baseline");
  await expect(page.getByText("デモ用の架空のベースラインを表示しています")).toBeVisible();
  await expect(page.getByTestId("baseline-count")).toContainText("40行");

  // CSV:Excelから貼り付けたようなタブ区切り。3行目は日付の誤り
  const header = "受付日時\tお客様\t品名・図番\t種類(新規/リピート/改訂)\t図面枚数\t見積担当\t作業時間:営業・事務(分)\t作業時間:見積担当(分)\t回答日時\tお客様への問い合わせ\t受注/失注\tメモ";
  const csv = [
    header,
    "2026/7/6 9:30\tA社\t部品A\t新規\t1\t代表取締役 白石\t15\t45\t2026/7/8 16:00\tなし\t受注\t",
    "2026/7/7\tB社\t部品B\tリピート\t1\t営業部 青木\t10\t30\t2026/7/13\tあり\t失注\t営業の時間は推定",
    "2026-13-40\tC社\t部品C\t新規\t1\t工場長 森\t5\t25\t\t\t\t",
    "2026-07-08\tD社\t部品D\t改訂\t2\t工場長 森\t5\t25\t2026-07-09\tなし\t\t",
  ].join("\n");
  await page.getByLabel("CSVの内容を貼り付け").fill(csv);
  await page.getByRole("button", { name: "今の行を置き換える" }).click();
  await expect(page.getByTestId("baseline-count")).toContainText("3行(うちメモに「推定」とある行 1行)");
  const errors = page.getByTestId("import-errors");
  await expect(errors).toContainText("4行目");
  await expect(errors).toContainText("存在しない日付です(2026-13-40)");

  // 1件ずつ入力:回答日が受付日より前なら追加しない
  await page.getByLabel("受付日(必須)").fill("2026-07-09");
  await page.getByLabel("回答日").fill("2026-07-01");
  await page.getByRole("button", { name: "この行を追加" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "回答日は受付日以降" })).toBeVisible();
  await page.getByLabel("回答日").fill("2026-07-16");
  await page.getByLabel("見積担当", { exact: true }).fill("白石");
  await page.getByLabel("作業時間:営業・事務(分)").fill("10");
  await page.getByLabel("作業時間:見積担当(分)").fill("50");
  await page.getByRole("button", { name: "この行を追加" }).click();
  await expect(page.getByTestId("baseline-count")).toContainText("4行");

  // この内容での導入前の値(画面の中で計算):受付→回答 2,4,1,5営業日 → 中央値3、作業時間 60,40,30,60分 → 平均48(47.5)
  const preview = page.getByTestId("baseline-preview");
  await expect(preview).toContainText("3営業日");
  await expect(preview).toContainText("48分");
  await expect(preview).toContainText("25%"); // 4件中、見積担当者以外(営業部 青木)が1件
  await expect(preview).toContainText("(参考値)");

  await page.getByRole("button", { name: "ベースラインを保存" }).click();
  await expect(page.getByTestId("baseline-message")).toContainText("ベースラインを保存しました(4行)");

  // ダッシュボードの導入前に反映される(件数が少ないので参考値)
  await page.goto("/dashboard");
  await expect(page.getByTestId("impact-context")).toContainText("御社が入力したベースライン");
  const row = (id: string) => page.getByRole("table", { name: "導入前後の比較" }).getByTestId(`row-${id}`);
  await expect(row("leadTime")).toContainText("3営業日(参考値)");
  await expect(row("workMinutes")).toContainText("48分(参考値)");
  await expect(row("nonEstimator")).toContainText("25%(参考値)");
  await expect(row("winRate")).toContainText("50%(参考値)"); // 回答済みで結果のある2件のうち1件が受注
  await expect(row("deficit")).toContainText("対象なし"); // 実績原価の列がない → 分母0

  // 書き出し → 同じ内容で読み直せる
  const exported = await (await request.get("/api/impact/export?format=csv&part=baseline")).text();
  expect(exported).toContain("受付日時,お客様");
  expect(exported).toContain("2026-07-13");
  expect(exported).toContain("営業の時間は推定");

  // 保存したベースラインを削除すると、デモ用の架空のベースラインに戻る
  await page.goto("/dashboard/baseline");
  await page.getByRole("button", { name: "保存したベースラインを削除" }).click();
  await page.getByRole("button", { name: "本当に削除する" }).click();
  await expect(page.getByTestId("baseline-count")).toContainText("40行");
});

test("このアプリの実際の記録:作成者・承認・結果の記録が、受注率・採用率・見積と実績の差に集計される", async ({ page, request }) => {
  // 何も処理していない状態:導入後は0件
  await page.goto("/dashboard?source=app");
  await expect(page.getByTestId("impact-context")).toContainText("このアプリで処理した実際の記録");
  await expect(page.getByText(/引き合いを登録して見積を承認すると/)).toBeVisible();

  // 登録(見積を作る人を選ぶ)→ 類似案件 → 見積根拠 → 承認
  await page.goto("/inquiries/new");
  await page.getByRole("button", { name: /サンプル1/ }).click();
  await expect(page.getByRole("list", { name: "追加した図面" }).getByRole("listitem")).toHaveCount(2);
  await page.getByLabel("この見積を作る人(任意)").selectOption("営業部 青木");
  await page.getByRole("button", { name: "登録して読み取る" }).click();
  await expect(page).toHaveURL(/\/inquiries\/[0-9a-f-]{36}$/);
  const inquiryId = page.url().split("/").pop();
  await page.getByRole("button", { name: "類似案件を検索して工数案を作る" }).click();
  await expect(page).toHaveURL(/\/similar$/);
  await page.getByRole("link", { name: "見積根拠へ進む" }).click();
  await page.getByRole("checkbox", { name: /未確認の項目.*を確認したうえで承認する/ }).check();
  await page.getByRole("button", { name: "この内容で承認して見積書へ" }).click();
  await expect(page).toHaveURL(/\/document$/);
  await page.getByRole("link", { name: "Salesforceに登録する" }).click();
  await expect(page).toHaveURL(/\/crm$/);

  // 結果の記録:受注、実績原価、手戻り1件
  await expect(page.getByRole("heading", { name: "結果の記録(効果測定用)" })).toBeVisible();
  await page.locator("select:has(option[value=won])").selectOption("won");
  await page.getByLabel("実績原価(円・税抜)").fill("500000");
  await page.getByLabel("受注後の手戻り件数").fill("1");
  await page.getByRole("button", { name: "結果を記録" }).click();
  await expect(page.getByText("結果を記録しました")).toBeVisible();

  await page.getByRole("link", { name: "効果測定ダッシュボードで集計を見る" }).click();
  await expect(page).toHaveURL(/\/dashboard\?source=app/);
  await expect(page.getByTestId("impact-context")).toContainText("1件");
  // 1件だけなので、どれも参考値
  const nonEst = page.getByTestId("kpi-nonEstimator");
  await expect(nonEst).toContainText("100%");
  await expect(nonEst).toContainText("参考値");
  await expect(page.getByTestId("kpi-winRate")).toContainText("100%");
  await expect(page.getByTestId("kpi-deficit")).toContainText("0%"); // 実績500,000円は受注額(約80万円)以内
  await expect(page.getByTestId("kpi-rework")).toContainText("1件");
  await expect(page.getByTestId("kpi-adoption")).toContainText("%");
  // デモモード(AI未使用)なので、AI費用は0円ではなく「対象なし」
  await expect(page.getByTestId("kpi-aiCost")).toContainText("—");
  await expect(page.getByTestId("kpi-leadTime")).toContainText("0営業日");
  // 項目別の採用率(修正のない項目は100%)
  await expect(page.getByTestId("adoption-bars")).toContainText("工程の工数");

  // 後続のテスト(一覧・Salesforceモックの件数)に影響しないよう、この引き合いは消す
  expect((await request.delete(`/api/inquiries/${inquiryId}`)).ok()).toBe(true);
});

test.describe("スマホ幅(390px)とダークモード", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "dark" });

  test("ダッシュボード・ベースライン・報告書で横スクロールが出ず、文字が読める", async ({ page }) => {
    for (const url of ["/dashboard", "/dashboard?g=month", "/dashboard/baseline", "/dashboard/report"]) {
      await page.goto(url);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoHorizontalScroll(page);
      expect(await findLowContrastText(page), url).toEqual([]);
    }
  });

  test("スマホ幅でもグラフは幅に収まり、タップで値が読める", async ({ page }) => {
    await page.goto("/dashboard");
    const lead = shown(page, "trend-leadTime");
    const svg = lead.locator("svg[role=presentation]");
    const box = await svg.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(390);
    await svg.tap({ position: { x: 150, y: 80 } });
    await expect(lead.getByText("値に使えた件数")).toBeVisible();
  });
});
