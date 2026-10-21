// 解析 Worker のバンドルを作る。
//   node scripts/build-worker.mjs            本番用(minify・内容のハッシュ付きのファイル名)
//   node scripts/build-worker.mjs --watch    開発用(エンジンを直しながら開発するとき。ファイル名は固定)
// 出力: public/engine/inventory-worker-<hash>.js と src/generated/engine-asset.json(画面が読む Worker の URL)
// - エンジン(apps/inventory/src)は tsconfig の @engine/* で参照し、依存は apps/inventory/node_modules から解決する
// - minify してもエラーのクラス名が変わらないよう keepNames を付ける(画面は Worker が返す固定のコードで判定するが、念のため)
// - バンドルに通信の API の呼び出しが含まれていたら失敗させる(依存が持っていた場合は内容を確かめて ALLOWED に理由付きで足す)
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild";
import { ENGINE_ROOT, engineBrowserPlugin } from "./engine-plugin.mjs";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ENTRY = join(APP_ROOT, "src/worker/engine.worker.ts");
const PUBLIC_DIR = join(APP_ROOT, "public/engine");
const GENERATED = join(APP_ROOT, "src/generated/engine-asset.json");
export const DEV_FILE_NAME = "inventory-worker-dev.js";

/**
 * 通信・別のスクリプトの実行・保存に使える API の呼び出しの形と、Worker の守り(lockdown.ts)を迂回する書き方。
 * 見つかればビルドを失敗させる(Worker の CSP と lockdown に加えた三重目の守り)。
 */
export const FORBIDDEN_PATTERNS = [
  /\bfetch\s*\(/,
  /\bfetch\s*\.\s*(?:call|apply|bind)\b/,
  /\.prototype\.fetch\b/,
  /\bnew\s+XMLHttpRequest\b/,
  /\bsendBeacon\s*\(/,
  /\bnew\s+WebSocket\b/,
  /\bnew\s+EventSource\b/,
  /\bimportScripts\s*\(/,
  /\bnew\s+WebTransport\b/,
  /\bnew\s+(?:Shared)?Worker\b/,
  /\bimport\s*\(/,
  /\bcaches\s*\./,
  /\bindexedDB\s*\./,
  /\bnew\s+BroadcastChannel\b/,
  /\bReflect\s*\.\s*apply\b/,
  /\bgetPrototypeOf\s*\(\s*(?:self|globalThis)\b/,
];

/**
 * 例外として許すもの(前後の文字列に当てはまる場合)と理由。
 * - zod の関数スキーマ(z.function().implement)が引数・戻り値を検証しながら呼ぶための Reflect.apply。
 *   呼ぶ関数は zod の利用者が渡したもので、通信の API ではない(エンジンは z.function を使っていない)
 */
const ALLOWED = [{ pattern: /_def\.input\?[\s\S]*Reflect\.apply\(/, reason: "zod の z.function() の実装" }];

export function findForbidden(code) {
  const found = [];
  for (const re of FORBIDDEN_PATTERNS) {
    const global = new RegExp(re.source, "g");
    for (const m of code.matchAll(global)) {
      const around = code.slice(Math.max(0, m.index - 60), m.index + 60);
      if (ALLOWED.some((a) => a.pattern.test(around))) continue;
      found.push({ pattern: re.source, around });
    }
  }
  return found;
}

function engineVersion() {
  return JSON.parse(readFileSync(join(ENGINE_ROOT, "package.json"), "utf8")).version;
}

function options({ dev }) {
  return {
    entryPoints: [ENTRY],
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "es2022",
    minify: !dev,
    keepNames: true,
    legalComments: "eof",
    charset: "utf8",
    logLevel: "warning",
    plugins: [engineBrowserPlugin],
    tsconfig: join(APP_ROOT, "tsconfig.json"),
    define: { "process.env.NODE_ENV": dev ? '"development"' : '"production"' },
  };
}

/** バンドルを作って文字列で返す(書き込まない)。単体テストからも使う */
export async function bundleWorker({ dev = false } = {}) {
  const result = await build({ ...options({ dev }), write: false, outfile: "worker.js" });
  const code = result.outputFiles[0].text;
  const forbidden = findForbidden(code);
  if (forbidden.length > 0) {
    throw new Error(
      `解析 Worker のバンドルに通信の API の呼び出しが含まれています:\n${forbidden.map((f) => `  ${f.pattern}: …${f.around}…`).join("\n")}`,
    );
  }
  return code;
}

function writeAsset(fileName, code) {
  rmSync(PUBLIC_DIR, { recursive: true, force: true });
  mkdirSync(PUBLIC_DIR, { recursive: true });
  writeFileSync(join(PUBLIC_DIR, fileName), code);
  mkdirSync(dirname(GENERATED), { recursive: true });
  const asset = {
    workerUrl: `/engine/${fileName}`,
    engineVersion: engineVersion(),
    bytes: Buffer.byteLength(code),
  };
  writeFileSync(GENERATED, `${JSON.stringify(asset, null, 2)}\n`);
  return asset;
}

export async function buildWorker() {
  const code = await bundleWorker();
  const hash = createHash("sha256").update(code).digest("hex").slice(0, 12);
  const asset = writeAsset(`inventory-worker-${hash}.js`, code);
  console.log(`解析 Worker を作成しました: public${asset.workerUrl}(${(asset.bytes / 1024).toFixed(0)} KB)`);
  return asset;
}

async function watch() {
  // 開発サーバーは public/ のファイル一覧を起動時に集めるため、開発中はファイル名を固定にする
  writeAsset(DEV_FILE_NAME, "");
  const ctx = await context({
    ...options({ dev: true }),
    outfile: join(PUBLIC_DIR, DEV_FILE_NAME),
    plugins: [
      engineBrowserPlugin,
      {
        name: "report",
        setup(b) {
          b.onEnd((r) => console.log(`解析 Worker を更新しました(エラー ${r.errors.length} 件)`));
        },
      },
    ],
  });
  await ctx.watch();
  console.log("解析 Worker の変更を監視しています(Ctrl+C で終了)");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--watch")) await watch();
  else await buildWorker();
}
