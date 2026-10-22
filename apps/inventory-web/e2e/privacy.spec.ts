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
async function evaluateInWorker<T>(page: Page, fn: (arg: string) => T | Promise<T>, arg = ""): Promise<T> {
  let engine = null;
  for (const w of page.workers()) {
    if ((await w.evaluate(() => self.name).catch(() => "")) === "inventory-engine") engine = w;
  }
  expect(engine, "解析 Worker が無い").not.toBeNull();
  return engine!.evaluate(fn, arg);
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
  // 解析を始めてからの通信は、解析の前に読み込んだものと完全に同じ URL(予備の解析 Worker の作り直しなど)だけ。
  // 新しい URL(クエリ付きの要求を含む)は1件も無い
  const loadedBefore = new Set(requests.slice(0, beforeAnalysis).map((r) => r.url));
  const isDownloadBlob = (u: string) => new RegExp(`^blob:${origin}/[0-9a-f-]{36}$`).test(u);
  const after = requests.slice(beforeAnalysis).filter((r) => !loadedBefore.has(r.url) && !isDownloadBlob(r.url));
  expect(after.map((r) => r.url)).toEqual([]);
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

  expect(csp).toMatch(/worker-src 'self'(;|$)/);

  // 解析 Worker のスクリプトには、通信・スクリプトの読み込み・Worker の作成をすべて禁止する CSP と、長期キャッシュが付く
  const workerUrl = await page.evaluate(() =>
    performance.getEntriesByType("resource").map((e) => e.name).find((n) => n.includes("/engine/inventory-worker-")),
  );
  expect(workerUrl).toBeTruthy();
  const workerRes = await request.get(workerUrl!);
  const workerCsp = workerRes.headers()["content-security-policy"];
  for (const directive of ["default-src 'none'", "connect-src 'none'", "script-src 'none'", "worker-src 'none'"]) {
    expect(workerCsp).toContain(directive);
  }
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

  // 外部のスクリプト・スタイルを読まない。外部へのリンクは相談ページ・プライバシーポリシー・利用規約だけ
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
  expect(external.anchors.sort()).toEqual(["https://example.com/contact", "https://example.com/privacy", "https://example.com/terms"]);

  // フッターに運営者名と利用規約・プライバシーポリシーのリンクを出す(NEXT_PUBLIC_OPERATOR_NAME・NEXT_PUBLIC_TERMS_URL)
  const footer = page.getByRole("contentinfo");
  await expect(footer).toContainText("運営:E2E運営株式会社");
  await expect(footer.getByRole("link", { name: /利用規約/ })).toHaveAttribute("href", "https://example.com/terms");
  await expect(footer.getByRole("link", { name: /プライバシーポリシー/ })).toHaveAttribute("href", "https://example.com/privacy");
});

test("解析 Worker の中からは、抜け道(プロトタイプの fetch・入れ子の Worker・import()・Cache API)を使っても通信できない", async ({ page, context, baseURL }) => {
  // CSP で止められた読み込みも「要求」としては記録されることがあるため、応答が返ったか(サーバーに届いたか)で判定する
  const answered: string[] = [];
  const failed: string[] = [];
  context.on("response", (r) => {
    if (r.url().includes("probe")) answered.push(`${r.status()} ${r.url()}`);
  });
  context.on("requestfailed", (r) => {
    if (r.url().includes("probe")) failed.push(`${r.url()} ${r.failure()?.errorText}`);
  });
  await page.goto("/");
  await waitForReady(page);
  const origin = new URL(baseURL!).origin;
  // 画面から Blob の Worker を作って送る(CSP の worker-src 'self' で起動できない)
  await page.evaluate((o) => {
    try {
      new Worker(URL.createObjectURL(new Blob([`fetch('${o}/probe-page-blob?d=x')`], { type: "text/javascript" })));
    } catch {
      // 止められる
    }
  }, origin);
  const results = await evaluateInWorker(page, async (o: string) => {
    const out: Record<string, string> = {};
    const attempt = async (name: string, f: () => unknown) => {
      try {
        await f();
        out[name] = "通信できた";
      } catch {
        out[name] = "止められた";
      }
    };
    const protoWith = (key: string) => {
      let p: object | null = Object.getPrototypeOf(self);
      while (p && !Object.prototype.hasOwnProperty.call(p, key)) p = Object.getPrototypeOf(p);
      return p as Record<string, unknown> | null;
    };
    const g = self as unknown as Record<string, unknown>;
    await attempt("fetch", () => (g.fetch as (u: string) => Promise<unknown>)(`${o}/probe-fetch?d=x`));
    await attempt("プロトタイプの fetch", () => (protoWith("fetch")!.fetch as (u: string) => Promise<unknown>).call(self, `${o}/probe-proto?d=x`));
    await attempt("XMLHttpRequest", () => {
      const X = (protoWith("XMLHttpRequest") ?? g).XMLHttpRequest as new () => XMLHttpRequest;
      const x = new X();
      x.open("GET", `${o}/probe-xhr?d=x`, false);
      x.send();
    });
    await attempt("入れ子の Worker", () => new (g.Worker as new (u: string) => unknown)(`${o}/probe-nested.js?d=x`));
    await attempt("import()", () => import(/* @vite-ignore */ `${o}/probe-import.js?d=x`));
    await attempt("Cache API", async () => {
      const c = await (g.caches as CacheStorage).open("x");
      await c.add(`${o}/probe-cache?d=x`);
    });
    await attempt("importScripts", () => (g.importScripts as (u: string) => void)(`${o}/probe-import-scripts.js?d=x`));
    return out;
  }, origin);
  await page.waitForTimeout(1_000);
  expect(Object.entries(results).filter(([, v]) => v !== "止められた")).toEqual([]);
  expect(answered, `サーバーに届いた: ${answered.join(" / ")}(止められたもの: ${failed.join(" / ")})`).toEqual([]);
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
