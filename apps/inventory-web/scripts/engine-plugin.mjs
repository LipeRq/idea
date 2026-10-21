// 解析エンジン(apps/inventory)をブラウザ用にバンドルするときの esbuild プラグイン。
// エンジンの scripts/build-browser.mjs にある plugin と同じ処理(エンジン側のファイルは編集しない方針のため、ここに写している)。
// - mdb-reader の environment モジュールを、エンジンの src/browser/mdbEnvironment.ts に差し替える
//   (元のモジュールは browserify-aes などを読み込み、Node.js のポリフィルが必要になるため)
// - Node.js の組み込みモジュール("buffer" は npm の buffer パッケージなので除く)が混ざったらビルドを失敗させる
// パスは呼び出し側の作業ディレクトリではなく、このファイルの場所を基準に解決する。
import { builtinModules } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const ENGINE_ROOT = resolve(here, "../../inventory");
export const MDB_ENVIRONMENT = resolve(ENGINE_ROOT, "src/browser/mdbEnvironment.ts");

export const engineBrowserPlugin = {
  name: "inventory-browser",
  setup(b) {
    b.onResolve({ filter: /environment\/index\.js$/ }, (a) =>
      a.importer.includes("mdb-reader") ? { path: MDB_ENVIRONMENT } : undefined,
    );
    const builtins = new RegExp(`^(node:.*|${builtinModules.filter((m) => m !== "buffer").join("|")})$`);
    b.onResolve({ filter: builtins }, (a) => ({
      errors: [{ text: `ブラウザ用のバンドルに Node.js の組み込みモジュール "${a.path}" が含まれています(${a.importer})` }],
    }));
  },
};
