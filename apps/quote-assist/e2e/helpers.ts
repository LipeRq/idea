import path from "node:path";
import { expect, type Page } from "@playwright/test";

// npm run test:e2e はアプリのディレクトリで実行する
export const SAMPLES = path.join(process.cwd(), "public", "samples");

/**
 * Next.js 16 はクライアント遷移の前の画面を非表示(display:none)のまま残すので、
 * testid や文字列で探すときは表示中の要素だけにする
 */
export function shown(page: Page, testId: string) {
  return page.getByTestId(testId).filter({ visible: true });
}

/** ボタンが押せる(ハイドレーションが終わった)まで待つ */
export async function waitForHydration(page: Page, buttonName: string | RegExp) {
  await expect(page.getByRole("button", { name: buttonName })).toBeEnabled();
}

export function fieldRow(page: Page, label: string) {
  return page.getByRole("table", { name: "抽出結果" }).getByRole("row", { name: new RegExp(`^${label}`) });
}

/** ページ全体に横スクロールが出ていないこと。出ていればはみ出した要素を示す */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const offenders = [...document.body.querySelectorAll<HTMLElement>("*")]
      .filter((el) => {
        // 横スクロールできる箱(表など)の中身は除く
        for (let p = el.parentElement; p; p = p.parentElement) {
          if (["auto", "scroll"].includes(getComputedStyle(p).overflowX)) return false;
        }
        return el.getBoundingClientRect().right > width + 0.5;
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 120));
    return { scrollWidth: document.documentElement.scrollWidth, width, offenders };
  });
  expect(
    overflow.scrollWidth,
    `横スクロールが出ている: ${overflow.offenders.join(" / ")}`,
  ).toBeLessThanOrEqual(overflow.width);
}

/**
 * 文字色と実際の背景色(半透明は重ねて計算)のコントラスト比がWCAG AAを満たさない要素を返す。
 * 大きい文字(24px以上、または18.66px以上の太字)は3:1、それ以外は4.5:1。
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
      const ownText = [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? "")
        .join("")
        .trim();
      if (!ownText || el.closest("select, option, .sr-only")) continue;
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
      if (ratio < required) {
        failures.push({ text: ownText.slice(0, 30), ratio: Math.round(ratio * 100) / 100, required });
      }
    }
    return failures;
  }, rootSelector);
}
