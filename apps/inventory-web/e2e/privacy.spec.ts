// 「ファイルはブラウザの外に出ない」ことの確認(docs/design.md §4.1・§7.2)
import { expect, test, type Page } from "@playwright/test";
import { FIXTURES, MARKER } from "./constants";
import {
  analyzeFixture,
  backToSelect,
  downloadBy,
  expectNoCspViolations,
  installCspRecorder,
  openTab,
  openTechnicalExports,
  saveHtmlReport,
  recordRequests,
  waitForReady,
} from "./helpers";

/** 解析に使っている Worker の中で式を評価する(page.workers() のうち、まだ動いているもの) */
async function evaluateInWorker<T>(page: Page, fn: () => T): Promise<T> {
  const workers = page.workers();
  expect(workers.length, "解析 Worker が無い").toBeGreaterThan(0);
  return workers[workers.length - 1].evaluate(fn);
}

test("解析から保存までの間、ファイルの中身・ファイル名を送信しない(リクエストは同一オリジンの GET だけ)", async ({ page, context, baseURL }) => {
  const requests = recordRequests(context);
  await installCspRecorder(page);
  await page.goto("/");
  await waitForReady(page);
  const beforeAnalysis = requests.length;

  await analyzeFixture(page, FIXTURES.secret);
  await openTab(page, "処理の流れ");
  await expect(page.getByRole("tabpanel").locator('figure[data-diagram-status="done"] svg').first()).toBeVisible({ timeout: 20_000 });
  await openTab(page, "仕様書(全文)");
  await saveHtmlReport(page);
  await openTechnicalExports(page);
  await downloadBy(page, () => page.getByRole("button", { name: "仕様書(Markdown)" }).click());
  const json = await downloadBy(page, () => page.getByRole("button", { name: "抽出結果(JSON)" }).click());
  // 解析は実際に行われ、目印はダウンロードした結果(手元)には入っている
  expect(json.text).toContain(MARKER.source);
  // ダミーのパスワードは解析の段階で伏せ字になっている
  expect(json.text).not.toContain(MARKER.password);

  const origin = new URL(baseURL!).origin;
  const forbidden = [MARKER.source, MARKER.password, MARKER.apiKey, FIXTURES.secret, encodeURIComponent(FIXTURES.secret), "顧客台帳"];
  for (const r of requests) {
    expect(new URL(r.url).origin, `外部への通信: ${r.url}`).toBe(origin);
    expect(r.method, `GET 以外の通信: ${r.method} ${r.url}`).toBe("GET");
    expect(r.postData, `本文付きの通信: ${r.url}`).toBeNull();
    for (const word of forbidden) expect(decodeURIComponent(r.url), `URL にファイル由来の文字列: ${r.url}`).not.toContain(word);
  }
  // 解析を始めてからの通信は、画面の部品の読み込み(同一オリジンの GET)だけ
  // (blob: は解析 Worker をメモリ上のスクリプトから起動したもの。ネットワークには出ない)
  const after = requests
    .slice(beforeAnalysis)
    .filter((r) => !r.url.startsWith("blob:") && !/\/_next\/|\/engine\/|\/favicon/.test(new URL(r.url).pathname));
  expect(after.map((r) => r.url)).toEqual([]);

  // 解析 Worker の中では通信の API が使えない(コードに混入しても送れない)
  const blocked = await evaluateInWorker(page, () =>
    ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts"].map((name) => {
      try {
        const api = (self as unknown as Record<string, unknown>)[name] as (...args: unknown[]) => unknown;
        api("/x");
        return `${name}: 使える`;
      } catch {
        return `${name}: 使えない`;
      }
    }),
  );
  expect(blocked.filter((b) => b.endsWith(": 使える"))).toEqual([]);

  await expectNoCspViolations(page);
});

test("CSP で外部への通信が止まり、外部の読み込みもない", async ({ page, request }) => {
  await installCspRecorder(page);
  const response = await page.goto("/");
  await waitForReady(page);
  const csp = response!.headers()["content-security-policy"];
  expect(csp).toContain("connect-src 'self'");
  expect(csp).toContain("default-src 'self'");
  expect(csp).not.toContain("unsafe-eval");
  expect(csp).not.toMatch(/https?:\/\//);

  // Worker のスクリプトにも同じヘッダーと、長期キャッシュが付く
  const workerUrl = await page.evaluate(() =>
    performance.getEntriesByType("resource").map((e) => e.name).find((n) => n.includes("/engine/inventory-worker-")),
  );
  expect(workerUrl).toBeTruthy();
  const workerRes = await request.get(workerUrl!);
  expect(workerRes.headers()["content-security-policy"]).toContain("connect-src 'self'");
  expect(workerRes.headers()["cache-control"]).toContain("immutable");

  // 画面からの外部への fetch はブラウザが止める
  const result = await page.evaluate(async () => {
    try {
      await window["fetch"]("https://example.com/collect", { method: "POST", body: "x" });
      return "sent";
    } catch {
      return "blocked";
    }
  });
  expect(result).toBe("blocked");
  const violations = await page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations);
  expect(violations.some((v) => v.startsWith("connect-src"))).toBe(true);

  // 外部のスクリプト・スタイルを読まない。外部へのリンクは相談ページとプライバシーポリシーだけ
  const external = await page.evaluate(() => {
    const here = location.origin;
    const srcs = [...document.querySelectorAll<HTMLScriptElement>("script[src]")].map((s) => s.src);
    const links = [...document.querySelectorAll<HTMLLinkElement>("link[href]")].map((l) => l.href);
    const anchors = [...document.querySelectorAll<HTMLAnchorElement>("a[href]")].map((a) => a.href);
    return {
      resources: [...srcs, ...links].filter((u) => new URL(u).origin !== here),
      anchors: anchors.filter((u) => new URL(u).origin !== here),
    };
  });
  expect(external.resources).toEqual([]);
  expect(external.anchors.sort()).toEqual(["https://example.com/contact", "https://example.com/privacy"]);
});

test("Worker の中の CSP 違反も検知できる(検知の仕組みの確認)", async ({ page }) => {
  await installCspRecorder(page);
  await page.goto("/");
  await waitForReady(page);
  await expect(page.locator("main")).toHaveAttribute("data-csp-violations", "0");
  // 文字列のコードの実行(eval と同じ扱い)は CSP で禁止しているので、Worker で試すと違反になる。
  // (開発者ツール経由の evaluate の中の eval は CSP の確認が省かれるため、後で実行される setTimeout の文字列で試す)
  await evaluateInWorker(page, () => {
    (setTimeout as unknown as (code: string, ms: number) => number)("void 0", 0);
  });
  await expect(page.locator("main")).not.toHaveAttribute("data-csp-violations", "0");
});

test("ページを開いた後はネットワークを切っても、解析・図・保存ができる", async ({ page, context }) => {
  await installCspRecorder(page);
  await page.goto("/");
  await waitForReady(page);
  await context.setOffline(true);
  try {
    await analyzeFixture(page, FIXTURES.secret);
    // 初めて図のあるタブを開く(図の描画に必要なものは、オフラインにする前に読み込み済み)
    await openTab(page, "処理の流れ");
    await expect(page.getByRole("tabpanel").locator('figure[data-diagram-status="done"] svg').first()).toBeVisible({ timeout: 20_000 });
    await openTab(page, "仕様書(全文)");
    await expect(page.getByRole("tabpanel").locator(".doc-body .mermaid-src svg").first()).toBeVisible({ timeout: 20_000 });
    const html = await saveHtmlReport(page);
    expect(html.text).toContain("<svg");
    await openTechnicalExports(page);
    const md = await downloadBy(page, () => page.getByRole("button", { name: "仕様書(Markdown)" }).click());
    expect(md.text).toContain(FIXTURES.secret);

    // 2件目(予備の Worker の作り直しもオフラインでできる)
    await backToSelect(page);
    await analyzeFixture(page, FIXTURES.second);
  } finally {
    await context.setOffline(false);
  }
  await expectNoCspViolations(page);
});
