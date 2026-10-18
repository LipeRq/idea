// ブラウザ(Playwright の Chromium)で解析エンジンを動かし、Node.js と同じ結果になるかを確かめる。
//   npm run test:browser
// 必要なもの: Playwright とインストール済みの Chromium(PLAYWRIGHT_BROWSERS_PATH)。playwright install は行わない。
// 1. scripts/build-browser.mjs で IIFE 形式のバンドルを作る
// 2. テスト用の合成ブック(.xlsm / .xlsb / .xls)と Access のテストデータを Node.js 側で用意する
// 3. ブラウザ内で analyzeBuffer と renderMarkdown を実行し、Node.js での結果と JSON で比較する
// 4. ブラウザの TextDecoder("shift_jis") が、以前使っていた iconv-lite の cp932 と同じ文字になるかを全コードで比較する
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import iconv from "iconv-lite";
import { analyzeBuffer, renderMarkdown } from "../src/browser";
import { SAMPLE_PROJECT } from "../test/helpers/sampleVba";
import { buildXls, buildXlsb, buildXlsm } from "../test/helpers/workbooks";

const root = resolve(import.meta.dirname, "..");
const now = "2026-10-18T00:00:00.000Z";

function loadPlaywright(): typeof import("playwright") {
  const require = createRequire(import.meta.url);
  const paths = [root];
  try {
    paths.push(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim());
  } catch {
    // npm が無ければローカルだけを探す
  }
  return require(require.resolve("playwright", { paths }));
}

const out = join(mkdtempSync(join(tmpdir(), "inventory-browser-")), "engine.iife.js");
execFileSync(process.execPath, [join(root, "scripts/build-browser.mjs"), out, "--iife"], { stdio: "inherit" });
const bundle = readFileSync(out, "utf8");

const accessDir = join(root, "test/fixtures/access");
const cases: { name: string; bytes: Uint8Array; password?: string; browserUnsupported?: boolean }[] = [
  { name: "売上管理.xlsm", bytes: buildXlsm(SAMPLE_PROJECT) },
  { name: "売上.xlsb", bytes: buildXlsb(SAMPLE_PROJECT) },
  { name: "古い集計.xls", bytes: buildXls(SAMPLE_PROJECT) },
  ...["queryTestV2010.accdb", "queryTestV2003.mdb", "linkerTestV2007.accdb", "odbcLinkerTestV2007.accdb", "V2010_with-password.accdb"].map(
    (name) => ({ name, bytes: new Uint8Array(readFileSync(join(accessDir, name))) }),
  ),
  // パスワードで暗号化された .accdb は、パスワードが正しくてもブラウザ版では未対応(Node.js では読める)
  { name: "V2010_with-password.accdb", bytes: new Uint8Array(readFileSync(join(accessDir, "V2010_with-password.accdb"))), password: "password", browserUnsupported: true },
];

type Outcome = { ok: true; report: unknown; markdown: string } | { ok: false; error: string; message: string };

function runInNode(c: (typeof cases)[number]): Outcome {
  try {
    const report = analyzeBuffer(c.bytes, c.name, { now: new Date(now), password: c.password });
    return { ok: true, report: JSON.parse(JSON.stringify(report)), markdown: renderMarkdown(report) };
  } catch (e) {
    return { ok: false, error: (e as Error).name, message: (e as Error).message };
  }
}

const { chromium } = loadPlaywright();
const browser = await chromium.launch();
let failures = 0;
try {
  const page = await browser.newPage();
  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  await page.setContent("<!doctype html><meta charset=utf-8><title>inventory</title>");
  await page.addScriptTag({ content: bundle });
  const env = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    hasProcess: typeof (globalThis as { process?: unknown }).process !== "undefined",
    hasRequire: typeof (globalThis as { require?: unknown }).require !== "undefined",
  }));
  console.log(`ブラウザ: ${env.userAgent}`);
  if (env.hasProcess || env.hasRequire) throw new Error("ブラウザに process / require があります(Node.js の環境が混ざっています)");

  for (const c of cases) {
    const expected = runInNode(c);
    const actual: Outcome = await page.evaluate(
      ({ b64, name, now, password }) => {
        const engine = (globalThis as unknown as { InventoryEngine: typeof import("../src/browser") }).InventoryEngine;
        const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
        try {
          const report = engine.analyzeBuffer(bytes, name, { now: new Date(now), password });
          return { ok: true as const, report: JSON.parse(JSON.stringify(report)), markdown: engine.renderMarkdown(report) };
        } catch (e) {
          return { ok: false as const, error: (e as Error).name, message: (e as Error).message };
        }
      },
      { b64: Buffer.from(c.bytes).toString("base64"), name: c.name, now, password: c.password },
    );
    const label = `${c.name}${c.password ? "(パスワードあり)" : ""}: `;
    if (c.browserUnsupported) {
      const asExpected = expected.ok && !actual.ok && actual.error === "UnsupportedFileError";
      console.log(`${label}${asExpected ? "想定どおり" : "想定と異なる"}(Node.js: ${expected.ok ? "解析できる" : expected.message} / ブラウザ: ${actual.ok ? "解析できた" : `${actual.error}「${actual.message}」`})`);
      if (!asExpected) failures++;
    } else if (expected.ok && actual.ok) {
      const same = JSON.stringify(expected.report) === JSON.stringify(actual.report) && expected.markdown === actual.markdown;
      const r = actual.report as { stats: { moduleCount: number; procedureCount: number; tableCount: number; queryCount: number } };
      console.log(`${label}${same ? "一致" : "不一致"}(モジュール ${r.stats.moduleCount}、プロシージャ ${r.stats.procedureCount}、テーブル ${r.stats.tableCount}、クエリ ${r.stats.queryCount})`);
      if (!same) failures++;
    } else if (!expected.ok && !actual.ok) {
      // 暗号化された .accdb はブラウザ版では未対応(Node.js ではパスワード無しなので PasswordError)
      console.log(`${label}どちらもエラー(Node.js: ${expected.error}「${expected.message}」 / ブラウザ: ${actual.error}「${actual.message}」)`);
      if (!/Error$/.test(actual.error)) failures++;
    } else {
      console.log(`${label}結果が異なります`, JSON.stringify({ node: expected.ok ? "ok" : expected, browser: actual.ok ? "ok" : actual }));
      failures++;
    }
  }

  // shift_jis(cp932)の全コードの比較
  const codes: number[][] = [];
  for (let b = 0; b < 0x80; b++) codes.push([b]);
  for (let b = 0xa1; b <= 0xdf; b++) codes.push([b]);
  for (let h = 0x81; h <= 0xfc; h++) {
    if (h >= 0xa0 && h <= 0xdf) continue;
    for (let l = 0x40; l <= 0xfc; l++) if (l !== 0x7f) codes.push([h, l]);
  }
  const expectedChars = codes.map((c) => iconv.decode(Buffer.from(c), "cp932"));
  const valid = codes.map((_, i) => [...expectedChars[i]].length === 1 && expectedChars[i] !== "�");
  const browserChars: string[] = await page.evaluate((list) => list.map((c) => new TextDecoder("shift_jis").decode(Uint8Array.from(c))), codes);
  const diffs = codes.filter((_, i) => valid[i] && browserChars[i] !== expectedChars[i]);
  console.log(
    `shift_jis: 有効な ${valid.filter(Boolean).length} 文字のうち、iconv-lite(cp932)と異なるもの ${diffs.length} 件${diffs.length > 0 ? `(例: ${diffs.slice(0, 5).map((d) => d.map((x) => x.toString(16)).join("")).join(", ")})` : ""}`,
  );
  if (diffs.length > 0) failures++;
  if (consoleErrors.length > 0) {
    console.log("ページのエラー:", consoleErrors);
    failures++;
  }
} finally {
  await browser.close();
}

if (failures > 0) {
  console.error(`ブラウザでの確認: ${failures} 件の問題があります`);
  process.exit(1);
}
console.log("ブラウザでの確認: すべて一致しました");
