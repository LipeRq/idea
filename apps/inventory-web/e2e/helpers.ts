import { readFileSync } from "node:fs";
import { expect, type BrowserContext, type Download, type Locator, type Page, type Request } from "@playwright/test";
import { fixturePath } from "./constants";

/** ページ表示前に、CSP の違反を記録する仕組みを入れる(画面側。Worker 側は main[data-csp-violations] に数が出る) */
export async function installCspRecorder(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __cspViolations: string[] };
    w.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      w.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
}

/** 画面と Worker の両方で、CSP の違反が0件であること */
export async function expectNoCspViolations(page: Page) {
  const pageViolations = await page.evaluate(() => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? null);
  expect(pageViolations, "画面の CSP 違反の記録が無い(installCspRecorder を呼んでいない)").not.toBeNull();
  expect(pageViolations, "画面で CSP の違反が起きた").toEqual([]);
  await expect(page.locator("main[data-csp-violations]")).toHaveAttribute("data-csp-violations", "0");
}

export interface RecordedRequest {
  method: string;
  url: string;
  postData: string | null;
  resourceType: string;
}

/** ブラウザのコンテキストから出た全リクエストを記録する(Worker が出したものも含む) */
export function recordRequests(context: BrowserContext): RecordedRequest[] {
  const list: RecordedRequest[] = [];
  context.on("request", (r: Request) => {
    list.push({ method: r.method(), url: r.url(), postData: r.postData(), resourceType: r.resourceType() });
  });
  return list;
}

/** 解析プログラムと図の描画の準備ができるまで待つ */
export async function waitForReady(page: Page) {
  await expect(page.locator('main[data-engine-ready="true"][data-diagram-ready="true"]')).toBeAttached({ timeout: 30_000 });
}

export function fileInput(page: Page) {
  return page.locator('input[type="file"]');
}

/** 自分のファイルを選んで解析し、結果が出るまで待つ */
export async function analyzeFixture(page: Page, name: string) {
  await fileInput(page).setInputFiles(fixturePath(name));
  await expect(page.locator('main[data-view="result"]')).toBeAttached({ timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1, name: /棚卸しの結果/ })).toContainText(name);
}

/** 結果画面から選択画面に戻る(確認のダイアログを承認する) */
export async function backToSelect(page: Page) {
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "別のファイルを解析" }).click();
  await expect(page.locator('main[data-view="select"]')).toBeAttached();
}

export async function openTab(page: Page, name: string | RegExp) {
  await page.getByRole("tab", { name }).click();
  await expect(page.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
}

/** ボタンを押してダウンロードし、ファイル名と中身(文字列)を返す */
export async function downloadBy(page: Page, click: () => Promise<void>): Promise<{ name: string; text: string; download: Download }> {
  const [download] = await Promise.all([page.waitForEvent("download"), click()]);
  const path = await download.path();
  return { name: download.suggestedFilename(), text: readFileSync(path, "utf8"), download };
}

/** 「技術者向けの形式で保存」を開く(scope: 結果画面の上部なら page、AI 版ならそのタブのパネル) */
export async function openTechnicalExports(scope: Page | Locator) {
  // has: の中の locator は、外側の要素からの相対で探すため page から作る
  const page = "goto" in scope ? scope : scope.page();
  const details = scope.locator("details", { has: page.getByText("技術者向けの形式で保存") }).first();
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) await details.locator("summary").click();
}

/** 単体の HTML の保存(結果を表示した後に用意されるので、用意できてから押す) */
export async function saveHtmlReport(page: Page, name: string | RegExp = /^レポートを保存/) {
  const button = page.getByRole("button", { name });
  await expect(button).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  return downloadBy(page, () => button.click());
}

/** ページ全体に横スクロールが出ていないこと(apps/diagnosis の e2e/helpers.ts と同じ) */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const offenders = [...document.body.querySelectorAll<HTMLElement>("*")]
      .filter((el) => {
        for (let p = el.parentElement; p; p = p.parentElement) {
          if (["auto", "scroll", "hidden"].includes(getComputedStyle(p).overflowX)) return false;
        }
        return el.getBoundingClientRect().right > width + 0.5;
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 120));
    return { scrollWidth: document.documentElement.scrollWidth, width, offenders };
  });
  expect(overflow.scrollWidth, `横スクロールが出ている: ${overflow.offenders.join(" / ")}`).toBeLessThanOrEqual(overflow.width);
}

/**
 * 文字色と実際の背景色のコントラスト比が WCAG AA を満たさない要素を返す(apps/diagnosis の e2e/helpers.ts と同じ)。
 * 図(白い枠の中の SVG)は対象外。
 */
export async function findLowContrastText(page: Page, rootSelector = "main") {
  return page.evaluate((selector) => {
    type Rgba = { r: number; g: number; b: number; a: number };
    const parse = (value: string): Rgba | null => {
      const m = value.match(/^rgba?\(([^)]+)\)$/);
      if (!m) return null;
      const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return { r, g, b, a };
    };
    const over = (top: Rgba, bottom: Rgba): Rgba => ({
      r: top.r * top.a + bottom.r * (1 - top.a),
      g: top.g * top.a + bottom.g * (1 - top.a),
      b: top.b * top.a + bottom.b * (1 - top.a),
      a: 1,
    });
    const luminance = ({ r, g, b }: Rgba) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const backgroundOf = (el: Element): Rgba => {
      const layers: Rgba[] = [];
      for (let e: Element | null = el; e; e = e.parentElement) {
        const c = parse(getComputedStyle(e).backgroundColor);
        if (c && c.a > 0) {
          layers.push(c);
          if (c.a >= 1) break;
        }
      }
      let bg: Rgba = { r: 255, g: 255, b: 255, a: 1 };
      for (const layer of layers.reverse()) bg = over(layer, bg);
      return bg;
    };

    const root = document.querySelector(selector);
    if (!root) throw new Error(`${selector} が見つからない`);
    const failures: { text: string; ratio: number; required: number }[] = [];
    for (const el of root.querySelectorAll("*")) {
      if (el.closest("svg, select, option, .sr-only, .print-only")) continue;
      const ownText = [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? "")
        .join("")
        .trim();
      if (!ownText) continue;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (rect.width < 2 || rect.height < 2 || style.visibility === "hidden") continue;
      const color = parse(style.color);
      if (!color) continue;
      const bg = backgroundOf(el);
      const fg = over(color, bg);
      const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
      const ratio = (hi + 0.05) / (lo + 0.05);
      const size = parseFloat(style.fontSize);
      const bold = Number(style.fontWeight) >= 700;
      const required = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
      if (ratio < required) failures.push({ text: ownText.slice(0, 30), ratio: Math.round(ratio * 100) / 100, required });
    }
    return failures;
  }, rootSelector);
}
