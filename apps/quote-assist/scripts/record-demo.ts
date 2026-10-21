// デモの自動操作・録画:npm run demo:record
//
// docs/manufacturing/demo/demo-script.md の台本(5分デモ)どおりに見積アシストを操作し、次の2つを作る。
//   - 場面ごとのスクリーンショット(1280×800、ライトモード)→ docs/manufacturing/demo/screens/NN-*.png
//   - 操作の録画(1280×720、webm、字幕とカーソルつき、約5分)→ demo-output/quote-assist-demo.webm(git管理外)
//     チャプター(場面の開始時刻)→ demo-output/quote-assist-demo.chapters.txt
//     録画は台本の時間配分(場面1〜11の開始時刻)に合わせて進むので、予備の録画として流しながら台本どおりに話せる。
//
// アプリは本番ビルドを「デモモード」(APIキーなし・AI未使用・モックのSalesforce)で起動する。
// 引き合いの保存先は一時ディレクトリにし、終わったら消すので、既存の .data/ は汚さない。
// スクリーンショットと録画は別々に通しで操作する(画面の高さが違うため)。それぞれ新しい保存先で起動し直す。
//
// オプション(npm run demo:record -- --no-build のように渡す):
//   --no-build        既存の本番ビルド(.next)をそのまま使う(コードを変えていないとき)
//   --only=screens    スクリーンショットだけ作る / --only=video 録画だけ作る
//   --port=3530       起動するポート(既定 3530。環境変数 DEMO_PORT でも指定できる)
//   --pace=1          録画の速さの倍率(1.5 にすると1.5倍ゆっくり。1より小さくすると短くなる)
//   --headed          ブラウザを画面に表示する(画面のある環境で)

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { addDays, todayJst } from "../src/lib/dates";
import { DEMO_SCENARIOS } from "../src/lib/demo/scenarios";

const APP_DIR = process.cwd();
const REPO_DIR = path.resolve(APP_DIR, "../..");
const SCREENS_DIR = path.join(REPO_DIR, "docs", "manufacturing", "demo", "screens");
const OUTPUT_DIR = path.join(APP_DIR, "demo-output");
const VIDEO_FILE = path.join(OUTPUT_DIR, "quote-assist-demo.webm");
const CHAPTERS_FILE = path.join(OUTPUT_DIR, "quote-assist-demo.chapters.txt");
const NEXT_BIN = path.join(APP_DIR, "node_modules", "next", "dist", "bin", "next");

const SCREEN_SIZE = { width: 1280, height: 800 };
const VIDEO_SIZE = { width: 1280, height: 720 };

type Options = { build: boolean; screens: boolean; video: boolean; port: number; pace: number; headed: boolean };

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    build: true,
    screens: true,
    video: true,
    port: Number(process.env.DEMO_PORT ?? 3530),
    pace: 1,
    headed: false,
  };
  for (const arg of argv) {
    const [key, value] = arg.split("=");
    if (key === "--no-build") opts.build = false;
    else if (key === "--headed") opts.headed = true;
    else if (key === "--only" && (value === "screens" || value === "video")) {
      opts.screens = value === "screens";
      opts.video = value === "video";
    } else if (key === "--port" && Number(value) > 0) opts.port = Number(value);
    else if (key === "--pace" && Number(value) > 0) opts.pace = Number(value);
    else throw new Error(`不明なオプションです: ${arg}(scripts/record-demo.ts の先頭のコメントを参照)`);
  }
  return opts;
}

// ---------------------------------------------------------------- サーバー

function serverEnv(dataDir: string, port: number): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    NEXT_TELEMETRY_DISABLED: "1",
    // APIキーがあっても実際のAIは呼ばない(デモモードの固定結果)。Salesforceも常にモック
    ANTHROPIC_API_KEY: "",
    ANTHROPIC_AUTH_TOKEN: "",
    AI_PROVIDER: "demo",
    CRM_PROVIDER: "mock",
    STORAGE_DRIVER: "file",
    QUOTE_ASSIST_DATA_DIR: dataDir,
    QUOTE_ASSIST_REFERENCE_DIR: path.join(APP_DIR, "data"),
    // ローカルで録画するだけなので、本番ビルドの Basic 認証(src/proxy.ts)を明示的に外す(録画に認証の入力欄が映らないように)
    QUOTE_ASSIST_ALLOW_NO_AUTH: "true",
  };
  for (const key of ["TENANT_ID", "SF_INSTANCE_URL", "SF_CLIENT_ID", "SF_CLIENT_SECRET", "QUOTE_ASSIST_BASIC_AUTH_USER", "QUOTE_ASSIST_BASIC_AUTH_PASSWORD"]) {
    delete env[key];
  }
  return env;
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: APP_DIR, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (b) => (output += b));
    child.stderr.on("data", (b) => (output += b));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${path.basename(args[0] ?? command)} ${args[1] ?? ""} が失敗しました\n${output.slice(-4000)}`)),
    );
  });
}

async function assertPortFree(port: number) {
  await new Promise<void>((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", () => reject(new Error(`ポート${port}は使用中です。--port=35xx で別のポートを指定してください`)));
    probe.listen(port, () => probe.close(() => resolve()));
  });
}

// ---------------------------------------------------------------- デモの日付

/**
 * サンプル1の希望納期は「登録日の40日後」(src/lib/demo/scenarios.ts)。それが土日になる日は、
 * デモの「今日」を前にずらして金曜日の納期にする(土曜→1日前、日曜→2日前)。アプリの日付ロジックは変えない。
 */
function demoDayOffset(now = new Date()): number {
  const weekday = new Date(`${addDays(todayJst(now), 40)}T00:00:00Z`).getUTCDay();
  return weekday === 6 ? -1 : weekday === 0 ? -2 : 0;
}

/** Date の「今」だけを offsetMs ずらすスクリプト。サーバー(--require)とブラウザ(初期化スクリプト)で共用する */
function clockShiftScript(offsetMs: number): string {
  return `(() => {
  const RealDate = Date;
  const offset = ${offsetMs};
  class DemoDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...args);
    }
    static now() {
      return RealDate.now() + offset;
    }
  }
  globalThis.Date = DemoDate;
})();
`;
}

type Server = { url: string; stop: () => Promise<void> };

async function startServer(port: number, dataDir: string, clockFile: string | null): Promise<Server> {
  await assertPortFree(port);
  const env = serverEnv(dataDir, port);
  if (clockFile) env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --require ${JSON.stringify(clockFile)}`.trim();
  const child: ChildProcess = spawn(process.execPath, [NEXT_BIN, "start", "-p", String(port)], {
    cwd: APP_DIR,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let output = "";
  child.stdout?.on("data", (b) => (output += b));
  child.stderr?.on("data", (b) => (output += b));
  let exited = false;
  child.on("exit", () => (exited = true));

  const stop = async () => {
    if (exited || child.pid === undefined) return;
    const done = new Promise<void>((r) => child.once("exit", () => r()));
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        // すでに終了している
      }
    }, 5000);
    await done;
    clearTimeout(timer);
  };

  const url = `http://localhost:${port}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (exited) throw new Error(`サーバーが起動できませんでした(本番ビルドがない場合は --no-build を外してください)\n${output.slice(-3000)}`);
    try {
      const res = await fetch(url);
      if (res.ok) return { url, stop };
    } catch {
      // 起動待ち
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  await stop();
  throw new Error(`サーバーが60秒以内に応答しませんでした\n${output.slice(-3000)}`);
}

/**
 * Linux の録画環境では system-ui が中国語のフォントに解決され、漢字が中国語の字形になることがある。
 * 日本語のフォントがあれば、ブラウザのプロセスだけ fontconfig で優先させる(アプリのCSSは変えない)。
 */
function japaneseFontConfig(tmpDir: string): string | null {
  if (process.platform !== "linux") return null;
  const listed = spawnSync("fc-list", [":lang=ja", "family"], { encoding: "utf8" });
  if (listed.status !== 0) return null;
  const families = new Set(listed.stdout.split("\n").flatMap((l) => l.split(",")).map((s) => s.trim()));
  const proportional = ["Noto Sans CJK JP", "Noto Sans JP", "IPAPGothic", "IPAexGothic", "VL PGothic", "TakaoPGothic", "IPAGothic"].find((f) =>
    families.has(f),
  );
  if (!proportional) {
    console.warn("! 日本語フォントが見つかりません。漢字が中国語の字形で表示される場合があります(fonts-noto-cjk などを入れてください)");
    return null;
  }
  const fallback = families.has("IPAGothic") ? "IPAGothic" : proportional;
  const base = process.env.FONTCONFIG_FILE ?? "/etc/fonts/fonts.conf";
  const file = path.join(tmpDir, "fonts.conf");
  fs.writeFileSync(
    file,
    `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <include ignore_missing="yes">${base}</include>
  <match target="pattern">
    <test qual="any" name="family"><string>system-ui</string></test>
    <edit name="family" mode="prepend" binding="strong"><string>${proportional}</string></edit>
  </match>
  <match target="pattern">
    <test qual="any" name="family"><string>sans-serif</string></test>
    <edit name="family" mode="prepend" binding="strong"><string>${proportional}</string></edit>
  </match>
  <match target="pattern">
    <test name="lang" compare="contains"><string>ja</string></test>
    <edit name="family" mode="prepend" binding="weak"><string>${fallback}</string></edit>
  </match>
</fontconfig>
`,
  );
  return file;
}

// ---------------------------------------------------------------- 録画用の字幕とカーソル

/**
 * 録画のときだけページに入れる。字幕(場面の説明)と、マウスの位置・クリックを見せるカーソル。
 * ハイドレーションとぶつからないよう、ページの読み込みが終わってから body の末尾に足す。
 */
function overlayScript() {
  type Caption = { step: string; text: string };
  const w = window as unknown as { __demo?: { caption: (c: Caption) => void } };
  if (w.__demo) return;
  const KEY = "__demo_overlay";
  const saved = (): { caption?: Caption; x?: number; y?: number } => {
    try {
      return JSON.parse(sessionStorage.getItem(KEY) ?? "{}");
    } catch {
      return {};
    }
  };
  const save = (patch: object) => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ ...saved(), ...patch }));
    } catch {
      // 保存できなくても表示は続ける
    }
  };
  const base = "position:fixed;pointer-events:none;z-index:2147483647;";

  const cursor = () => {
    let el = document.getElementById("__demo-cursor");
    if (!el && document.body) {
      el = document.createElement("div");
      el.id = "__demo-cursor";
      el.setAttribute("aria-hidden", "true");
      el.style.cssText = `${base}left:0;top:0;width:24px;height:24px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45));`;
      el.innerHTML =
        '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M3 2 L3 19 L7.5 14.8 L10.6 21.5 L13.6 20.2 L10.5 13.6 L16.8 13.6 Z" fill="#ffffff" stroke="#111827" stroke-width="1.5" stroke-linejoin="round"/></svg>';
      document.body.appendChild(el);
    }
    return el;
  };
  const moveCursor = (x: number, y: number) => {
    const el = cursor();
    if (el) el.style.transform = `translate(${x - 3}px, ${y - 2}px)`;
  };

  const showCaption = (c: Caption | undefined) => {
    if (!document.body) return;
    let el = document.getElementById("__demo-caption");
    if (!c) {
      el?.remove();
      return;
    }
    if (!el) {
      el = document.createElement("div");
      el.id = "__demo-caption";
      el.setAttribute("aria-hidden", "true");
      el.style.cssText = `${base}left:50%;bottom:18px;transform:translateX(-50%);max-width:1120px;width:max-content;box-sizing:border-box;padding:10px 20px;border-radius:12px;background:rgba(17,24,39,.9);color:#fff;font:500 18px/1.55 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25);`;
      document.body.appendChild(el);
    }
    el.replaceChildren();
    const step = document.createElement("span");
    step.textContent = c.step;
    step.style.cssText = "display:inline-block;margin-right:12px;padding:1px 10px;border-radius:999px;background:#2563eb;font-weight:700;";
    const text = document.createElement("span");
    text.textContent = c.text;
    el.append(step, text);
  };

  window.addEventListener(
    "mousemove",
    (e) => {
      moveCursor(e.clientX, e.clientY);
      save({ x: e.clientX, y: e.clientY });
    },
    { capture: true, passive: true },
  );
  window.addEventListener(
    "mousedown",
    (e) => {
      if (!document.body) return;
      const ring = document.createElement("div");
      ring.setAttribute("aria-hidden", "true");
      ring.style.cssText = `${base}left:${e.clientX - 18}px;top:${e.clientY - 18}px;width:36px;height:36px;border-radius:50%;border:3px solid #f59e0b;background:rgba(245,158,11,.25);`;
      document.body.appendChild(ring);
      ring
        .animate([{ transform: "scale(.4)", opacity: 1 }, { transform: "scale(1.6)", opacity: 0 }], { duration: 650, easing: "ease-out" })
        .finished.then(() => ring.remove());
    },
    { capture: true, passive: true },
  );
  // ページを読み込み直したときは、字幕とカーソルを前の状態に戻す
  window.addEventListener("load", () =>
    setTimeout(() => {
      const s = saved();
      showCaption(s.caption);
      if (s.x !== undefined && s.y !== undefined) moveCursor(s.x, s.y);
    }, 300),
  );
  w.__demo = {
    caption: (c) => {
      save({ caption: c });
      showCaption(c);
    },
  };
}

// ---------------------------------------------------------------- 操作の進め方

type Mode = "screens" | "video";

/** 台本の1場面ずつの操作。録画ではゆっくり動かし、スクリーンショットでは素早く撮る */
class Director {
  readonly chapters: { atMs: number; step: string; title: string }[] = [];
  /** 台本の操作がすべて終わった時刻(開始からのミリ秒) */
  endedAtMs = 0;
  readonly shots: { file: string; title: string }[] = [];
  private shotIndex = 0;
  private readonly startedAt = Date.now();

  constructor(
    readonly page: Page,
    readonly mode: Mode,
    private readonly pace: number,
  ) {}

  private get recording() {
    return this.mode === "video";
  }

  elapsedMs() {
    return Date.now() - this.startedAt;
  }

  /** 人が読める間を置く(録画のときだけ。スクリーンショットでは描画が落ち着く程度) */
  async wait(ms: number) {
    await this.page.waitForTimeout(this.recording ? Math.round(ms * this.pace) : Math.min(ms, 150));
  }

  /**
   * 録画のとき、録画の開始から sec 秒になるまで今の画面を見せる。sec は demo-script.md の時間配分(5分)に合わせた時刻で、
   * 録画を台本と同じ速さにするため(予備の録画に合わせて話せる)。--pace の倍率もかける。すでに過ぎていれば待たない
   */
  async until(sec: number) {
    if (!this.recording) return;
    const rest = Math.round(sec * 1000 * this.pace) - this.elapsedMs();
    if (rest > 0) await this.page.waitForTimeout(rest);
  }

  /** 場面の始まり:チャプターを記録し、録画では字幕を出す。no は demo-script.md の場面番号(同じ場面の続きは同じ番号) */
  async scene(no: number, title: string, caption: string) {
    const step = `場面${no}`;
    this.chapters.push({ atMs: this.elapsedMs(), step, title });
    console.log(`  ${step} ${title}`);
    if (this.recording) {
      await this.page.evaluate((c) => (window as unknown as { __demo?: { caption: (x: object) => void } }).__demo?.caption(c), {
        step: `${no}. ${title}`,
        text: caption,
      });
      await this.wait(1200);
    }
  }

  /** スクリーンショットを撮る。録画では、その画面を見せる時間として待つ */
  async shot(name: string, holdMs = 3000) {
    if (this.recording) {
      await this.wait(holdMs);
      return;
    }
    // クリックしたリンクのホバー表示が写らないよう、マウスを画面の端に逃がす
    await this.page.mouse.move(SCREEN_SIZE.width - 2, SCREEN_SIZE.height - 2);
    await this.page.evaluate(() => document.fonts.ready.then(() => undefined));
    await this.page.waitForTimeout(250);
    this.shotIndex += 1;
    const file = path.join(SCREENS_DIR, `${String(this.shotIndex).padStart(2, "0")}-${name}.png`);
    await this.page.screenshot({ path: file, animations: "disabled", caret: "hide" });
    this.shots.push({ file, title: this.chapters.at(-1)?.title ?? "" });
  }

  /** 要素の上端が画面の上から offset px の位置に来るようにスクロールする */
  async scrollTo(target: Locator, offset = 24) {
    const el = target.first();
    await el.waitFor({ state: "visible" });
    await el.evaluate(
      (node, [off, smooth]) => {
        const top = node.getBoundingClientRect().top + window.scrollY - off;
        window.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "instant" });
      },
      [offset, this.recording] as const,
    );
    await this.scrollSettled();
    await this.wait(500);
  }

  async scrollTop() {
    await this.page.evaluate((smooth) => window.scrollTo({ top: 0, behavior: smooth ? "smooth" : "instant" }), this.recording);
    await this.scrollSettled();
  }

  private async scrollSettled() {
    await this.page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          let last = -1;
          let still = 0;
          const tick = () => {
            if (window.scrollY === last) still += 1;
            else {
              still = 0;
              last = window.scrollY;
            }
            if (still >= 6) resolve();
            else requestAnimationFrame(tick);
          };
          tick();
        }),
    );
  }

  /** 録画では、画面外の要素をなめらかにスクロールして見せる */
  private async bringIntoView(el: Locator) {
    const inView = await el.evaluate((node) => {
      const r = node.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight - 90;
    });
    if (inView) return;
    await el.evaluate((node) => node.scrollIntoView({ behavior: "smooth", block: "center" }));
    await this.scrollSettled();
  }

  /** カーソルで指し示す(録画のときだけ。スクリーンショットの通しでも、指す要素が画面にあるかは確かめる) */
  async point(target: Locator, holdMs = 1200) {
    const el = target.first();
    await el.waitFor({ state: "visible" });
    if (!this.recording) return;
    await this.bringIntoView(el);
    const box = await el.boundingBox();
    if (!box) return;
    await this.page.mouse.move(box.x + Math.min(box.width / 2, 160), box.y + box.height / 2, { steps: 30 });
    await this.wait(holdMs);
  }

  async click(target: Locator) {
    const el = target.first();
    if (this.recording) await this.point(el, 500);
    await el.click();
    await this.wait(400);
  }

  /** 数値を入れ直す。録画では1文字ずつ打つ */
  async retype(target: Locator, text: string) {
    const el = target.first();
    if (!this.recording) {
      await el.fill(text);
      return;
    }
    await this.point(el, 500);
    await el.click();
    await el.press("ControlOrMeta+a");
    await el.pressSequentially(text, { delay: 260 });
    await this.wait(600);
  }
}

// ---------------------------------------------------------------- 台本(demo-script.md の場面1〜11と対応。scene() の番号が場面番号)

async function runScenario(d: Director) {
  const { expect } = await import("@playwright/test");
  const { page } = d;
  const sample = DEMO_SCENARIOS[0]; // サンプル1:改訂品(リピート)
  const fieldRow = (label: string) => page.getByRole("table", { name: "抽出結果" }).getByRole("row", { name: new RegExp(`^${label}`) });
  const visibleText = (text: string | RegExp) => page.getByText(text).filter({ visible: true });

  // 場面1 見積待ち一覧(0:00〜0:30)
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("見積待ち一覧");
  await expect(page.getByTestId("mode")).toContainText("デモモード");
  // 台本・想定事例で読み上げる数値。データやプログラムが変わって食い違ったら、ここで止まる(台本と想定事例も直す)
  for (const value of ["12件", "3.3日", "53%", "21%"]) await expect(page.getByText(value, { exact: true }).first()).toBeVisible();
  await expect(page.getByText("うち8件が社長・工場長の確認待ち", { exact: false }).first()).toBeVisible();
  await d.scene(1, "見積待ち一覧", "見積が社長・工場長に集中している現状(会社・顧客・数値はすべて架空のデモデータ)");
  await d.shot("dashboard", 2500);
  await d.point(visibleText("うち8件が社長・工場長の確認待ち"), 2000);
  await d.until(10);
  await d.point(visibleText(/^過去案件\d+件の引き合い〜回答$/), 1800);
  await d.until(16);
  await d.scrollTo(page.getByRole("heading", { name: "見積待ち(デモ用の架空データ)" }));
  await d.shot("backlog", 2000);
  await d.point(page.getByRole("cell", { name: "社長・工場長の確認待ち", exact: true }), 1500);
  await d.until(27);
  await d.scrollTop();
  await d.click(page.getByRole("link", { name: "新しい引き合いを登録" }));

  // 場面2 引き合い登録(0:30〜0:50)
  await page.waitForURL(/\/inquiries\/new$/);
  await expect(page.getByRole("button", { name: "登録して読み取る" })).toBeEnabled();
  await d.scene(2, "引き合い登録", "引き合いメールの本文と図面PDF 2枚を登録(デモではサンプルを読み込む)");
  await d.click(page.getByRole("button", { name: `${sample.label}を読み込む` }));
  const files = page.getByRole("list", { name: "追加した図面" }).getByRole("listitem");
  await expect(files).toHaveCount(2);
  await expect(page.getByLabel("メール本文")).toHaveValue(/数量/);
  await d.scrollTo(page.getByText("デモ用サンプル", { exact: true }), 16);
  await d.shot("register", 2500);
  await d.point(page.getByRole("list", { name: "追加した図面" }), 1500);
  await d.until(42);
  await d.click(page.getByRole("button", { name: "登録して読み取る" }));

  // 場面3 抽出結果(0:50〜1:30)
  await page.waitForURL(/\/inquiries\/[0-9a-f-]{36}$/);
  await expect(fieldRow("材質")).toContainText("SUS304");
  await d.scene(3, "抽出結果", "図面とメールから読み取った項目を、確からしさと根拠(どの図面・メールのどこか)つきで表示");
  await d.shot("extraction-summary", 3000);
  await d.until(55);
  await d.scrollTo(page.getByRole("heading", { name: "抽出結果", exact: true }), 16);
  await d.shot("extraction-fields", 1500);
  await d.point(fieldRow("材質"), 2200);
  await d.until(64);
  await d.point(fieldRow("数量"), 1800);
  await d.until(70);
  await d.point(fieldRow("表面処理"), 1800);
  await d.until(75);
  await d.point(fieldRow("熱処理"), 2200);
  await d.until(83);

  // 場面4 確認事項(1:30〜1:50)
  await d.scene(4, "顧客への確認事項", "図面で決まっていない点(熱処理・検査成績書)を確認事項にし、確認メールの案を作る(送信は人)");
  // 「不足」の行と、そこから作った確認事項を1画面に入れる
  await d.scrollTo(fieldRow("熱処理"), 16);
  await d.point(page.getByRole("heading", { name: /^顧客への確認事項/ }), 1200);
  await expect(page.getByLabel("確認メールの案(送信は担当者が行います)")).toHaveValue(/熱処理は必要でしょうか/);
  await d.shot("questions", 4000);
  await d.until(102);
  await d.click(page.getByRole("button", { name: "類似案件を検索して工数案を作る" }));

  // 場面5 類似案件(1:50〜2:40)
  await page.waitForURL(/\/similar$/);
  const cases = page.getByRole("list", { name: "類似案件" }).getByRole("listitem").filter({ has: page.getByRole("heading") });
  const first = cases.first();
  await expect(first.getByRole("heading")).toHaveText("センサブラケット MS-24017 Rev.B");
  await d.scene(5, "類似案件", "過去案件200件(架空)から似た案件を検索。同じ図番の旧版は「実績が見積を超えた」と警告");
  await d.shot("similar", 2500);
  await d.point(first.getByText("同じ図番の旧版(Rev.B)"), 1800);
  await d.until(115);
  await d.point(first.getByText(/見積工数1\.2時間に対し実績1\.6時間/), 2500);
  await d.until(126);
  await d.scrollTo(cases.nth(1), 16);
  await d.shot("similar-more", 2000);
  await d.until(135);
  // 過去案件の詳細(工程別の見積と実績、不具合履歴)
  await d.click(first.getByRole("heading").getByRole("link"));
  await page.waitForURL(/\/cases\/[^/]+$/);
  await expect(page.getByRole("table", { name: "工程別の工数" })).toBeVisible();
  await d.scene(5, "過去案件の詳細", "旧版の見積工数と実績工数、めっき後の寸法不良の履歴を確認できる");
  await d.scrollTo(page.getByText(/^過去案件 Q-/), 12);
  await d.shot("past-case", 3500);
  await d.until(151);
  await page.goBack();
  await page.waitForURL(/\/similar$/);
  await d.click(page.getByRole("link", { name: "見積根拠へ進む" }));

  // 場面6 見積根拠(2:40〜3:10)
  await page.waitForURL(/\/quote$/);
  const total = page.getByTestId("quote-total").filter({ visible: true });
  await expect(total).toBeVisible();
  await expect(total).toContainText("800,000円");
  await d.scene(6, "見積根拠", "金額はAIではなくプログラムが単価表と工数から計算する。明細ごとに計算式と出典を表示");
  await d.shot("quote-summary", 2500);
  await d.point(page.getByRole("region", { name: "見積の合計" }).getByText("見積金額(税抜)"), 1500);
  await d.until(162);
  await d.point(page.getByRole("list", { name: "未確認の項目" }).filter({ visible: true }), 2000);
  await d.until(168);
  await d.scrollTo(page.getByRole("heading", { name: "見積明細(根拠つき)" }), 16);
  await d.shot("quote-lines", 2500);
  const materialLine = page.getByRole("table", { name: "見積明細" }).getByRole("row", { name: /^材料費/ });
  await d.point(materialLine, 1800);
  await d.until(176);
  await d.point(materialLine.getByRole("link", { name: "単価表(材料)" }), 1500);
  await d.until(183);

  // 場面7 工数の修正と再計算(3:10〜3:40)
  await d.scene(7, "人が修正すると即座に再計算", "社長役が、旧版の実績(マシニング1.35時間)に合わせて1個あたり時間を1.35時間に直す → 金額が計算し直され、出典が「人が修正」に");
  await d.scrollTo(page.getByRole("heading", { name: "工程別の工数" }), 16);
  const mcRow = page.getByRole("table", { name: "工程別の工数" }).getByRole("row", { name: /^マシニング加工/ });
  await d.point(mcRow, 1500);
  await d.retype(page.getByRole("spinbutton", { name: "マシニング加工の1個あたり加工時間(時間)" }), "1.35");
  const mcLine = page.getByRole("table", { name: "見積明細" }).getByRole("row", { name: /^加工費\(マシニング加工\)/ });
  await expect(mcLine).toContainText("1.35h × 数量係数0.9 × 50個 × 8,000円/h");
  await expect(mcRow).toContainText("人が修正");
  await expect(total).toContainText("892,500円");
  await d.shot("quote-edit", 2000);
  await d.until(198);
  await d.scrollTo(page.getByRole("heading", { name: "見積明細(根拠つき)" }), 16);
  await d.point(mcLine, 2000);
  await d.point(page.getByRole("table", { name: "見積明細" }).getByRole("row", { name: /^合計/ }), 1500);
  await d.shot("quote-recalculated", 1500);
  await d.until(205);
  const saveButton = page.getByRole("button", { name: "修正を保存" });
  await d.click(saveButton);
  // 保存すると画面が作り直され、未保存の修正がなくなる(保存ボタンが押せなくなる)
  await expect(saveButton).toBeDisabled();
  await expect(mcRow).toContainText("人が修正");
  // 根拠のリンクから単価表を開く
  await d.click(mcLine.getByRole("link", { name: "単価表(チャージ)" }));
  await page.waitForURL(/\/rates/);
  await d.scene(7, "単価表", "根拠のリンクから単価表(工程チャージ・材料・外注・見積ルール)を開ける。単価表を差し替えると計算が全部変わる");
  await d.shot("rates", 3500);
  await d.until(217);
  await page.goBack();
  await page.waitForURL(/\/quote$/);

  // 場面8 承認(3:40〜3:55)
  await d.scene(8, "人が承認", "未確認の項目が残っていると、確認した旨のチェックがないと承認できない(未確認のまま進めたことは記録に残る)。承認するまで見積書は下書きで、Salesforceにも登録できない");
  const ack = page.getByRole("checkbox", { name: /未確認の項目.*を確認したうえで承認する/ });
  await d.scrollTo(page.getByRole("heading", { name: /^確認ポイント/ }), 16);
  await d.point(page.getByRole("heading", { name: /^確認ポイント/ }), 1500);
  await d.click(ack);
  await expect(ack).toBeChecked();
  await d.shot("approve", 2000);
  await d.until(232);
  await d.click(page.getByRole("button", { name: "この内容で承認して見積書へ" }));

  // 場面9 見積書・回答メール(3:55〜4:20)
  await page.waitForURL(/\/document$/);
  const doc = page.getByRole("article", { name: "見積書" });
  await expect(doc.getByRole("heading", { level: 2 })).toHaveText("御見積書");
  await d.scene(9, "見積書・回答メール", "承認すると見積番号つきの見積書案と、確認事項を含む回答メールの案ができる(自動送信はしない)");
  await d.scrollTo(page.getByRole("button", { name: /印刷/ }), 16);
  await d.shot("document", 3500);
  await d.scrollTo(page.getByRole("heading", { name: "回答メールの案" }), 16);
  await d.shot("reply-email", 3500);
  await d.until(247);
  await d.scrollTop();
  await d.click(page.getByRole("link", { name: "Salesforceに登録する" }));

  // 場面10 Salesforce登録(4:20〜4:40)
  await page.waitForURL(/\/crm$/);
  const register = page.getByRole("button", { name: "Salesforce(モック)に商談と見積を登録" });
  await expect(register).toBeEnabled();
  await d.scene(10, "Salesforce登録", "承認済みの見積を Salesforce の商談・見積として登録(このデモはモック接続で、実際のSalesforceには送らない)");
  await d.scrollTo(page.getByRole("heading", { name: /^Salesforceへの登録/ }), 16);
  await d.shot("crm-before", 2500);
  await d.until(258);
  await d.click(register);
  await expect(page.getByTestId("crm-result").filter({ visible: true })).toContainText("商談");
  await d.shot("crm-registered", 2000);
  await d.until(264);
  await d.click(page.getByRole("link", { name: "登録した商談を開く" }));
  await page.waitForURL(/\/crm-mock/);
  await expect(page.getByRole("list", { name: "登録された商談" }).getByRole("listitem").first()).toBeVisible();
  await d.scene(10, "Salesforce(モック)の画面", "登録された商談と見積。本番接続では同じ内容を Salesforce の API で作る(実際の組織への接続は未検証)");
  await d.shot("crm-mock", 3500);
  await d.until(272);
  await page.goBack();
  await page.waitForURL(/\/crm$/);

  // 場面11 計測と記録(4:40〜5:00)
  await d.scene(11, "計測と修正の記録", "処理時間・AI費用・登録から承認まで・工数案の採用率と、人が直した記録が残る(デモモードのため処理時間はミリ秒・AI費用は0円と表示。実際のAIでは時間と費用がかかる)");
  await d.scrollTo(page.getByRole("heading", { name: "計測(この引き合い)" }), 16);
  await d.shot("metrics", 2500);
  await d.point(page.getByRole("region", { name: "計測の合計" }).getByText("登録から承認まで"), 1800);
  await d.point(page.getByRole("table", { name: "修正の記録" }).getByRole("row", { name: /マシニング加工の1個あたり時間/ }), 2500);
  await d.until(287);
  await d.scrollTop();
  await d.click(page.getByRole("navigation", { name: "メイン" }).getByRole("link", { name: "見積待ち一覧" }));
  await page.waitForURL((url) => url.pathname === "/");
  await expect(page.getByRole("row", { name: /センサブラケット MS-24017/ })).toContainText("CRM登録済み");
  await d.scene(11, "一覧に戻る", "処理した引き合いが一覧に並ぶ。過去案件から出した導入前の値と、導入後の記録を比べる材料になる");
  await d.shot("dashboard-after", 2500);
  await d.point(page.getByRole("row", { name: /センサブラケット MS-24017/ }), 3000);
  await d.until(300);
}

// ---------------------------------------------------------------- 実行

/** 録画の長さと大きさ(ffprobe があるとき) */
function probeVideo(file: string): { durationSec: number; width: number; height: number } | null {
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=width,height", "-of", "json", file], {
    encoding: "utf8",
  });
  if (probe.status !== 0) return null;
  try {
    const json = JSON.parse(probe.stdout) as { format?: { duration?: string }; streams?: { width?: number; height?: number }[] };
    const durationSec = Number(json.format?.duration);
    const stream = json.streams?.[0];
    if (!Number.isFinite(durationSec) || !stream?.width || !stream.height) return null;
    return { durationSec, width: stream.width, height: stream.height };
  } catch {
    return null;
  }
}

function formatClock(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(1, "0")}:${String(s % 60).padStart(2, "0")}`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(path.join(APP_DIR, "public", "samples")) || !fs.existsSync(NEXT_BIN)) {
    throw new Error("apps/quote-assist のディレクトリで実行してください(npm run demo:record)");
  }
  // プリインストールのブラウザを使う(未設定で /opt/pw-browsers があるとき)
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync("/opt/pw-browsers")) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = "/opt/pw-browsers";
  }
  const { chromium } = await import("@playwright/test");

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quote-assist-demo-"));
  const cleanups: (() => Promise<void>)[] = [async () => fs.rmSync(tmpRoot, { recursive: true, force: true })];
  const cleanup = async () => {
    for (const c of cleanups.splice(0).reverse()) await c().catch(() => undefined);
  };
  process.once("SIGINT", () => void cleanup().finally(() => process.exit(130)));

  // 前回の失敗の記録(failed-*)を消しておく
  if (fs.existsSync(OUTPUT_DIR)) {
    for (const f of fs.readdirSync(OUTPUT_DIR)) if (f.startsWith("failed-")) fs.rmSync(path.join(OUTPUT_DIR, f));
  }

  try {
    if (opts.build) {
      console.log("本番ビルドを作成しています(1〜2分)…");
      const started = Date.now();
      await run(process.execPath, [NEXT_BIN, "build"], { ...process.env, NEXT_TELEMETRY_DISABLED: "1" });
      console.log(`  ビルド完了(${Math.round((Date.now() - started) / 1000)}秒)`);
    }
    // 希望納期が土日になる日は、サーバーとブラウザの日付だけをずらす(デモの画面と台本の「平日の納期」をそろえる)
    const dayOffset = demoDayOffset();
    let clockFile: string | null = null;
    if (dayOffset !== 0) {
      clockFile = path.join(tmpRoot, "demo-clock.cjs");
      fs.writeFileSync(clockFile, clockShiftScript(dayOffset * 86_400_000));
      console.log(`希望納期(登録日の40日後)が土日になるため、デモの日付を${-dayOffset}日前にずらします`);
    }
    const fontConfig = japaneseFontConfig(tmpRoot);
    const browser = await chromium.launch({
      headless: !opts.headed,
      env: { ...process.env, ...(fontConfig ? { FONTCONFIG_FILE: fontConfig } : {}) },
    });
    cleanups.push(() => browser.close());
    const problems: string[] = [];

    const pass = async (mode: Mode) => {
      // 通しの操作ごとに、空の保存先でサーバーを起動し直す(一覧に前回の引き合いが残らないように)
      const dataDir = fs.mkdtempSync(path.join(tmpRoot, `${mode}-`));
      const server = await startServer(opts.port, dataDir, clockFile);
      cleanups.push(server.stop);
      const videoDir = path.join(tmpRoot, "video");
      const context = await browser.newContext({
        baseURL: server.url,
        viewport: mode === "screens" ? SCREEN_SIZE : VIDEO_SIZE,
        deviceScaleFactor: 1,
        colorScheme: "light",
        locale: "ja-JP",
        timezoneId: "Asia/Tokyo",
        ...(mode === "video" ? { recordVideo: { dir: videoDir, size: VIDEO_SIZE } } : {}),
      });
      // tsx(esbuild の keepNames)は関数の中の関数に __name(...) を付ける。ブラウザ側で実行する関数のために用意する
      await context.addInitScript({ content: "window.__name = window.__name || ((fn) => fn);" });
      if (clockFile) await context.addInitScript({ content: clockShiftScript(dayOffset * 86_400_000) });
      if (mode === "video") await context.addInitScript(overlayScript);
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      page.on("pageerror", (e) => problems.push(`[${mode}] ページのエラー: ${e.message}`));
      page.on("console", (m) => m.type() === "error" && problems.push(`[${mode}] コンソールのエラー: ${m.text()}`));
      const director = new Director(page, mode, opts.pace);
      let failed = false;
      try {
        await runScenario(director);
        director.endedAtMs = director.elapsedMs();
      } catch (e) {
        failed = true;
        const failShot = path.join(OUTPUT_DIR, `failed-${mode}.png`);
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        await page.screenshot({ path: failShot }).catch(() => undefined);
        console.error(`  失敗した時点の画面: ${failShot}`);
        throw e;
      } finally {
        const video = page.video();
        await context.close();
        if (video) {
          // 途中で止まった録画は、完成版と取り違えないよう別の名前で残す
          const target = failed ? path.join(OUTPUT_DIR, "failed-video.webm") : VIDEO_FILE;
          fs.mkdirSync(OUTPUT_DIR, { recursive: true });
          await video.saveAs(target);
          await video.delete();
          if (failed) console.error(`  途中までの録画: ${target}`);
        }
        await server.stop();
      }
      return director;
    };

    if (opts.screens) {
      console.log(`スクリーンショットを撮っています(${SCREEN_SIZE.width}×${SCREEN_SIZE.height}、ライトモード)…`);
      fs.mkdirSync(SCREENS_DIR, { recursive: true });
      for (const f of fs.readdirSync(SCREENS_DIR)) if (f.endsWith(".png")) fs.rmSync(path.join(SCREENS_DIR, f));
      const d = await pass("screens");
      console.log(`  ${d.shots.length}枚 → ${path.relative(REPO_DIR, SCREENS_DIR)}/`);
    }
    if (opts.video) {
      console.log(`操作を録画しています(${VIDEO_SIZE.width}×${VIDEO_SIZE.height}、待ち時間の倍率 ${opts.pace})…`);
      const d = await pass("video");
      const video = probeVideo(VIDEO_FILE);
      // 録画は、画面の取り込みの都合で実際の経過時間より数%長くなることがある(5分で10秒ほど)。
      // ずれは時間に比例して大きくなるので、場面の開始時刻を録画の長さに合わせて伸ばし、録画の中の時刻にする
      const ratio = video && d.endedAtMs > 0 ? (video.durationSec * 1000) / d.endedAtMs : 1;
      const scale = ratio > 0.9 && ratio < 1.2 ? ratio : 1;
      const chapters = d.chapters.map((c) => `${formatClock(c.atMs * scale)} ${c.step} ${c.title}`).join("\n");
      fs.writeFileSync(
        CHAPTERS_FILE,
        `見積アシスト デモ録画のチャプター(デモモード・架空データ。${new Date().toISOString()} に作成)\n` +
          `録画の中で各場面が始まる時刻です(操作の時刻を録画の長さに合わせて補正。±2秒程度ずれることがあります)。\n${chapters}\n`,
      );
      const info = video ? `(${video.width}×${video.height}・${formatClock(video.durationSec * 1000)})` : "";
      console.log(`  録画 → ${path.relative(REPO_DIR, VIDEO_FILE)} ${info}`);
      console.log(`  チャプター → ${path.relative(REPO_DIR, CHAPTERS_FILE)}\n${chapters.replace(/^/gm, "    ")}`);
    }
    if (problems.length > 0) {
      console.warn(`\n! 操作中にブラウザでエラーが出ました(${problems.length}件)`);
      for (const p of [...new Set(problems)].slice(0, 20)) console.warn(`  ${p}`);
    }
  } finally {
    await cleanup();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
