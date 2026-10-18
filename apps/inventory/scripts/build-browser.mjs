// 解析エンジンをブラウザ用の1ファイル(ES Module)にまとめる。
//   node scripts/build-browser.mjs [出力先(既定: dist/inventory-engine.js)] [--iife]
// - Node.js の組み込みモジュールは使わない(使っていたらここでビルドが失敗する)
// - "buffer" は npm の buffer パッケージ(mdb-reader が Buffer を前提にしているため)
// - mdb-reader の environment モジュールを src/browser/mdbEnvironment.ts に差し替える
import { build } from "esbuild";
import { builtinModules } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const iife = args.includes("--iife");
const outfile = resolve(root, args.find((a) => !a.startsWith("--")) ?? (iife ? "dist/inventory-engine.iife.js" : "dist/inventory-engine.js"));

const browserPlugin = {
  name: "inventory-browser",
  setup(b) {
    b.onResolve({ filter: /environment\/index\.js$/ }, (a) =>
      a.importer.includes(`${"mdb-reader"}`) ? { path: resolve(root, "src/browser/mdbEnvironment.ts") } : undefined,
    );
    const builtins = new RegExp(`^(node:.*|${builtinModules.filter((m) => m !== "buffer").join("|")})$`);
    b.onResolve({ filter: builtins }, (a) => ({
      errors: [{ text: `ブラウザ用のバンドルに Node.js の組み込みモジュール "${a.path}" が含まれています(${a.importer})` }],
    }));
  },
};

const result = await build({
  entryPoints: [resolve(root, "src/browser.ts")],
  bundle: true,
  platform: "browser",
  format: iife ? "iife" : "esm",
  globalName: iife ? "InventoryEngine" : undefined,
  target: "es2022",
  outfile,
  sourcemap: true,
  metafile: true,
  legalComments: "eof",
  logLevel: "warning",
  plugins: [browserPlugin],
});

const bytes = Object.values(result.metafile.outputs).find((o) => o.entryPoint)?.bytes ?? 0;
console.log(`ブラウザ用バンドルを作成しました: ${outfile}(${(bytes / 1024).toFixed(0)} KB)`);
