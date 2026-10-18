import { expect, type Page } from "@playwright/test";
import { READINESS_QUESTIONS, TASKS, type TaskId } from "../src/lib/diagnosis/master";

export type CompanyAnswers = {
  companyName?: string;
  industry: string;
  employees: string;
  goals?: string[];
  challenges?: string;
};

export function formAlert(page: Page) {
  // Next.js のルートアナウンサーも role="alert" を持つので、フォームの中に絞る
  return page.locator("form").getByRole("alert");
}

export function currentStep(page: Page) {
  return page.getByRole("list", { name: "入力ステップ" }).locator('[aria-current="step"]');
}

export function nextButton(page: Page) {
  return page.getByRole("button", { name: "次へ" });
}

export function backButton(page: Page) {
  return page.getByRole("button", { name: "戻る" });
}

export function industrySelect(page: Page) {
  return page.getByLabel("業種");
}

export function employeesSelect(page: Page) {
  return page.getByLabel("従業員規模");
}

export function goalCheckbox(page: Page, goal: string) {
  return page.getByRole("checkbox", { name: goal, exact: true });
}

export function hoursInput(page: Page, taskId: TaskId) {
  const task = TASKS.find((t) => t.id === taskId)!;
  return page.getByRole("spinbutton", { name: new RegExp(`^${task.name}`) });
}

export function hourlyCostInput(page: Page) {
  return page.getByRole("spinbutton", { name: /^平均人件費/ });
}

export function readinessRadio(page: Page, questionIndex: number, optionIndex: number) {
  const q = READINESS_QUESTIONS[questionIndex];
  return page
    .getByRole("group", { name: q.label, exact: true })
    .getByRole("radio", { name: q.options[optionIndex], exact: true });
}

export async function fillCompanyStep(page: Page, answers: CompanyAnswers) {
  if (answers.companyName !== undefined) {
    await page.getByLabel("会社名(任意)").fill(answers.companyName);
  }
  await industrySelect(page).selectOption(answers.industry);
  await employeesSelect(page).selectOption(answers.employees);
  for (const goal of answers.goals ?? []) {
    // チェックボックス本体は視覚的に隠してあるので、ラベル(チップ)を押す
    await page.locator("label", { hasText: goal }).click();
    await expect(goalCheckbox(page, goal)).toBeChecked();
  }
  if (answers.challenges !== undefined) {
    await page.getByLabel("いま困っていること(任意)").fill(answers.challenges);
  }
}

export async function fillHoursStep(
  page: Page,
  hours: Partial<Record<TaskId, number>>,
  hourlyCost?: number,
) {
  for (const [taskId, h] of Object.entries(hours)) {
    await hoursInput(page, taskId as TaskId).fill(String(h));
  }
  if (hourlyCost !== undefined) {
    await hourlyCostInput(page).fill(String(hourlyCost));
  }
}

/** 準備度の6問すべてに同じ段階(0〜3)で答える */
export async function answerAllReadiness(page: Page, optionIndex: number) {
  for (let i = 0; i < READINESS_QUESTIONS.length; i++) {
    await readinessRadio(page, i, optionIndex).check();
  }
}

export async function submitAndWaitForResult(page: Page) {
  await page.getByRole("button", { name: "診断する" }).click();
  await expect(page.getByRole("heading", { level: 2, name: /AI導入診断レポート/ })).toBeVisible({
    timeout: 30_000,
  });
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
