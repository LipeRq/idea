// Node.js 用: ファイルパスから読んで解析する(ブラウザでは analyzeBuffer を使う)。
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { analyzeBuffer, type AnalyzeOptions } from "./analyze";
import type { InventoryReport } from "./schema";

export async function analyzeFile(path: string, options: AnalyzeOptions = {}): Promise<InventoryReport> {
  const data = await readFile(path);
  return analyzeBuffer(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), basename(path), {
    sha256: (bytes) => createHash("sha256").update(bytes).digest("hex"),
    ...options,
  });
}
