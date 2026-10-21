// 開発・ビルドの前の準備(package.json の predev / prebuild から呼ぶ。単体テスト・型検査の前には不要で、pretest / pretypecheck は置いていない)。
// 1. 解析エンジン(apps/inventory)の依存が入っていなければ npm ci する(Worker のバンドルとサーバーの AI ルートが使う)
// 2. 解析 Worker のバンドルを作る(public/engine/、src/generated/engine-asset.json)
// 3. サンプルを取り込む(public/samples/、src/generated/samples.json)
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildWorker } from "./build-worker.mjs";
import { ENGINE_ROOT } from "./engine-plugin.mjs";
import { runSyncSamples } from "./sync-samples.mjs";

if (!existsSync(join(ENGINE_ROOT, "node_modules"))) {
  console.log("解析エンジンの依存をインストールします(apps/inventory で npm ci)");
  execFileSync("npm", ["ci"], { cwd: ENGINE_ROOT, stdio: "inherit", shell: process.platform === "win32" });
}
await buildWorker();
runSyncSamples();
