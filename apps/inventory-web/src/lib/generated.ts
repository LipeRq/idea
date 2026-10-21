// ビルド前の準備(scripts/prepare.mjs)が作るファイルを、サーバーコンポーネントで読む。
// ページは静的に生成されるので、読むのはビルド時だけ。ファイルが無い(準備を実行していない)ときは既定値にする。
// (静的な import にしないのは、準備の前でも型チェックが通るようにするため)
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SampleEntry } from "./samples";

export interface EngineAsset {
  workerUrl: string;
  engineVersion: string;
  bytes: number;
}

function readJson<T>(name: string): T | null {
  try {
    return JSON.parse(readFileSync(path.join(process.cwd(), "src/generated", name), "utf8")) as T;
  } catch {
    return null;
  }
}

export function engineAsset(): EngineAsset {
  return readJson<EngineAsset>("engine-asset.json") ?? { workerUrl: "/engine/inventory-worker-missing.js", engineVersion: "不明", bytes: 0 };
}

export function samples(): SampleEntry[] {
  const list = readJson<SampleEntry[]>("samples.json");
  return Array.isArray(list) ? list : [];
}
