// サンプルを取り込む(predev / prebuild で prepare.mjs から呼ぶ)。
//   INVENTORY_SAMPLES_DIR を指定すると、そのディレクトリから取り込む(E2E はテスト用のサンプルで確かめる)
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ENGINE_ROOT } from "./engine-plugin.mjs";
import { syncSamples } from "./samples-manifest.mjs";

const APP_ROOT = resolve(fileURLToPath(import.meta.url), "../..");

export function runSyncSamples() {
  const sourceDir = process.env.INVENTORY_SAMPLES_DIR ? resolve(APP_ROOT, process.env.INVENTORY_SAMPLES_DIR) : join(ENGINE_ROOT, "samples");
  const result = syncSamples({
    sourceDir,
    publicDir: join(APP_ROOT, "public/samples"),
    generatedFile: join(APP_ROOT, "src/generated/samples.json"),
  });
  if (result.status === "missing") {
    console.warn(`サンプルが見つからないため「サンプルで試す」は表示しません(${join(sourceDir, "manifest.json")} がありません)`);
  } else {
    console.log(`サンプルを ${result.count} 件取り込みました(${sourceDir})`);
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runSyncSamples();
