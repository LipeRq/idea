import { expect, test, type APIResponse, type Page } from "@playwright/test";
import { OG_TITLE } from "../src/lib/site";
import { E2E_SITE_URL } from "./constants";
import { diagnoseKnownInput } from "./helpers";

// 公開ページとしての仕上げ(メタデータ・OGP・robots・sitemap・404・セキュリティヘッダー)と、
// Turnstile が無効なときに外部へ接続せずに最後まで使えること、計測に個人情報を送らないこと。
// E2Eのビルドは NEXT_PUBLIC_SITE_URL を E2E_SITE_URL に、計測を debug(ページの変数に記録するだけ)にしている。

const siteUrlPattern = (path: string) =>
  new RegExp(`^${E2E_SITE_URL.replaceAll(".", "\\.")}${path}`);

function metaContent(page: Page, selector: string) {
  return page.locator(`head ${selector}`).first().getAttribute("content");
}

async function expectPng(res: APIResponse, width: number, height: number) {
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/png");
  const body = await res.body();
  expect(body.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  // IHDR チャンクの幅と高さ
  expect([body.readUInt32BE(16), body.readUInt32BE(20)]).toEqual([width, height]);
}

test("メタデータ:タイトル・説明・OGP・Twitterカード・canonical が公開URLで出る", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("無料のAI導入診断");
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  expect(await metaContent(page, 'meta[name="description"]')).toContain("無料診断");
  expect(await metaContent(page, 'meta[name="robots"]')).toBe("index, follow");
  await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute("href", siteUrlPattern("/?$"));

  expect(await metaContent(page, 'meta[property="og:title"]')).toBe(OG_TITLE);
  expect(await metaContent(page, 'meta[property="og:type"]')).toBe("website");
  expect(await metaContent(page, 'meta[property="og:locale"]')).toBe("ja_JP");
  expect(await metaContent(page, 'meta[property="og:site_name"]')).toBe("AI導入診断");
  expect(await metaContent(page, 'meta[property="og:url"]')).toMatch(siteUrlPattern("/?$"));
  expect(await metaContent(page, 'meta[property="og:image"]')).toMatch(siteUrlPattern("/opengraph-image"));
  expect(await metaContent(page, 'meta[property="og:image:width"]')).toBe("1200");
  expect(await metaContent(page, 'meta[property="og:image:height"]')).toBe("630");
  expect(await metaContent(page, 'meta[property="og:image:alt"]')).toContain("AI導入診断");

  expect(await metaContent(page, 'meta[name="twitter:card"]')).toBe("summary_large_image");
  expect(await metaContent(page, 'meta[name="twitter:title"]')).toBe(OG_TITLE);
  expect(await metaContent(page, 'meta[name="twitter:image"]')).toMatch(siteUrlPattern("/twitter-image"));

  // ファビコン(ico と svg)とホーム画面用のアイコン
  const icons = await page
    .locator('head link[rel="icon"], head link[rel="apple-touch-icon"]')
    .evaluateAll((links) => links.map((l) => `${l.getAttribute("rel")} ${l.getAttribute("href")}`));
  expect(icons).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/^icon \/favicon\.ico/),
      expect.stringMatching(/^icon \/icon\.svg/),
      expect.stringMatching(/^apple-touch-icon \/apple-icon/),
    ]),
  );
});

test("OGP画像・Twitter画像・アイコンが画像として返る", async ({ page, request }) => {
  await page.goto("/");
  for (const selector of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
    // 画像のURLは公開URL(実在しないドメイン)なので、パスだけをテスト用のサーバーに送る
    const url = new URL((await metaContent(page, selector))!);
    await expectPng(await request.get(url.pathname + url.search), 1200, 630);
  }

  const appleIcon = await page.locator('head link[rel="apple-touch-icon"]').getAttribute("href");
  await expectPng(await request.get(appleIcon!), 180, 180);

  const favicon = await request.get("/favicon.ico");
  expect(favicon.status()).toBe(200);
  expect(favicon.headers()["content-type"]).toBe("image/x-icon");

  const svg = await request.get("/icon.svg");
  expect(svg.status()).toBe(200);
  expect(svg.headers()["content-type"]).toContain("image/svg+xml");
});

test("robots.txt と sitemap.xml が公開URLで返る", async ({ request }) => {
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  const robotsText = await robots.text();
  expect(robotsText).toContain("User-Agent: *");
  expect(robotsText).toContain("Allow: /");
  expect(robotsText).toContain("Disallow: /api/");
  expect(robotsText).toContain(`Sitemap: ${E2E_SITE_URL}/sitemap.xml`);

  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  expect(sitemap.headers()["content-type"]).toContain("xml");
  const xml = await sitemap.text();
  expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
  expect(xml).toMatch(new RegExp(`<loc>${E2E_SITE_URL.replaceAll(".", "\\.")}/?</loc>`));
});

test("存在しないページは404で、検索エンジンに載せず、診断ページへ戻れる", async ({ page }) => {
  const res = await page.goto("/no-such-page");
  expect(res?.status()).toBe(404);
  await expect(page).toHaveTitle("ページが見つかりません|AI導入診断");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("ページが見つかりません");
  expect(await metaContent(page, 'meta[name="robots"]')).toContain("noindex");

  await page.getByRole("link", { name: "無料のAI導入診断へ" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("御社の業務、AIでどれだけ減らせるか。");
});

test("セキュリティヘッダーが付き、Turnstile が無効でも外部に接続せずに診断・PDF・申し込みまで進める。計測に個人情報を送らない", async ({
  page,
  baseURL,
}) => {
  // CSPの違反と、外部(テスト用サーバー以外)へのリクエストを記録する
  await page.addInitScript(() => {
    const win = window as unknown as { __cspViolations: string[] };
    win.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      win.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  const externalRequests: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (!url.startsWith(baseURL!) && !/^(data|blob):/.test(url)) externalRequests.push(url);
  });

  const res = await page.goto("/");
  const headers = res!.headers();
  const csp = headers["content-security-policy"];
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).not.toContain("unsafe-eval");
  // Turnstile が無効なビルドでは、Cloudflare を許可しない
  expect(csp).not.toContain("challenges.cloudflare.com");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"]).toContain("camera=()");
  expect(headers["strict-transport-security"]).toContain("max-age=");
  expect(headers).not.toHaveProperty("x-powered-by");

  // 診断 → PDF → 申し込み
  await diagnoseKnownInput(page, "テスト工業");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDFをダウンロード" }).click();
  await downloading;

  const form = page.getByRole("form", { name: "無料相談のお申し込み" });
  await form.getByRole("textbox", { name: /^氏名/ }).fill("山田 太郎");
  await form.getByRole("textbox", { name: /^メールアドレス/ }).fill("taro@example.co.jp");
  await form.getByRole("textbox", { name: /^相談したい内容/ }).fill("見積書の作成を効率化したい");
  await form.getByRole("checkbox", { name: /個人情報の取り扱い/ }).check();
  const leadRequest = page.waitForRequest("**/api/lead");
  await form.getByRole("button", { name: "無料相談を申し込む" }).click();
  // Turnstile が無効なときはトークンを付けない
  expect((await leadRequest).headers()).not.toHaveProperty("x-turnstile-token");
  await expect(page.getByRole("heading", { name: "お申し込みを受け付けました" })).toBeVisible();

  expect(await page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations)).toEqual([]);
  expect(externalRequests).toEqual([]);
  await expect(page.locator('iframe[src*="challenges.cloudflare.com"]')).toHaveCount(0);

  // 計測:開始 → ステップ2・3 → 完了 → PDF → 申し込み。送るのは決まった値だけ
  const events = await page.evaluate(
    () => (window as unknown as { __analyticsEvents?: unknown[] }).__analyticsEvents,
  );
  expect(events).toEqual([
    { name: "diagnosis_start", params: {} },
    { name: "diagnosis_step", params: { step: 2, step_name: "業務にかかる時間" } },
    { name: "diagnosis_step", params: { step: 3, step_name: "IT環境" } },
    { name: "diagnosis_complete", params: { ai_generated: false } },
    { name: "report_download", params: { report_source: "standard" } },
    { name: "lead_submit", params: {} },
  ]);
  const sent = JSON.stringify(events);
  for (const personal of ["テスト工業", "山田", "taro", "見積書", "3000", "100"]) {
    expect(sent).not.toContain(personal);
  }
});
