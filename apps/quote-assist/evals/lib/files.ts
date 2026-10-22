import fs from "node:fs";
import path from "node:path";

// 結果の保存。evals/results/<日時>/ に、1件終わるごとに results.jsonl へ追記し、最後に JSON と Markdown の要約を書く。

/** 日本時間の yyyyMMdd-HHmmss */
export function runStamp(now: Date = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 3600_000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${jst.getUTCFullYear()}${p(jst.getUTCMonth() + 1)}${p(jst.getUTCDate())}-${p(jst.getUTCHours())}${p(jst.getUTCMinutes())}${p(jst.getUTCSeconds())}`;
}

export function createRunDir(baseDir: string, now: Date = new Date()): string {
  let dir = path.join(baseDir, runStamp(now));
  // 同じ秒に2回実行しても上書きしない
  for (let i = 2; fs.existsSync(dir); i++) dir = path.join(baseDir, `${runStamp(now)}-${i}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeJson(dir: string, name: string, data: unknown): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  return file;
}

export function writeText(dir: string, name: string, text: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, text.endsWith("\n") ? text : `${text}\n`);
  return file;
}

export function appendJsonl(dir: string, name: string, row: unknown): void {
  fs.appendFileSync(path.join(dir, name), `${JSON.stringify(row)}\n`);
}
