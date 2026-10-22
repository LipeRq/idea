// 合成データの生成:npm run generate-data
//   data/*.json            単価表・顧客・会社・過去案件・不具合・見積待ち一覧
//   public/samples/*.pdf   デモ用の引き合い図面
// 乱数の種を固定しているので、何度実行しても同じ内容になる。
//
// 図面の日本語は scripts/fonts/NotoSansJP-Drawing.ttf(Noto Sans JP を使う文字だけにサブセット、
// SIL Open Font License 1.1、ライセンス文は scripts/fonts/OFL.txt)で描く。
// 図面の文言を変えて足りない文字が出たら、--chars-only で文字一覧を書き出し、
// README.md の「図面用フォント」の手順でフォントを作り直す。

import fs from "node:fs";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { z } from "zod";
import { DEMO_SCENARIOS } from "../src/lib/demo/scenarios";
import {
  BacklogItemSchema,
  CompanySchema,
  CustomerSchema,
  DefectSchema,
  PastCaseSchema,
  RateTableSchema,
} from "../src/lib/domain/reference";
import { BaselineFileSchema, PilotFileSchema } from "../src/lib/domain/impact";
import { CollectCanvas, drawSheet, renderDrawingPdf } from "./lib/drawings";
import { backlog, company, customers, rateTable } from "./lib/masters";
import { generateBaseline, generatePilot } from "./lib/impact";
import { generatePastCases } from "./lib/past-cases";

const root = process.cwd();
const dataDir = path.join(root, "data");
const samplesDir = path.join(root, "public", "samples");
const fontDir = path.join(root, "scripts", "fonts");
const fontPath = path.join(fontDir, "NotoSansJP-Drawing.ttf");

function writeJson<T>(file: string, schema: z.ZodType<T>, value: T) {
  schema.parse(value);
  fs.writeFileSync(path.join(dataDir, file), `${JSON.stringify(value, null, 2)}\n`);
  console.log(`  data/${file}`);
}

function collectChars(): string {
  const canvas = new CollectCanvas();
  for (const s of DEMO_SCENARIOS) for (const d of s.drawings) drawSheet(canvas, d);
  for (let code = 0x20; code <= 0x7e; code++) canvas.chars.add(String.fromCharCode(code));
  return [...canvas.chars].sort().join("");
}

async function main() {
  const chars = collectChars();
  fs.writeFileSync(path.join(fontDir, "chars.txt"), chars);
  if (process.argv.includes("--chars-only")) {
    console.log(`scripts/fonts/chars.txt に ${[...chars].length} 文字を書き出しました`);
    return;
  }

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(samplesDir, { recursive: true });
  console.log("参照データ:");
  writeJson("rate-table.json", RateTableSchema, rateTable);
  writeJson("customers.json", z.array(CustomerSchema), customers);
  writeJson("company.json", CompanySchema, company);
  writeJson("backlog.json", z.array(BacklogItemSchema), backlog);
  const { cases, defects } = generatePastCases(rateTable);
  writeJson("past-cases.json", z.array(PastCaseSchema), cases);
  writeJson("defects.json", z.array(DefectSchema), defects);
  // 効果測定ダッシュボードのデモ用(導入前の記録シート、導入後の記録。どちらも架空)
  const impactBaseline = generateBaseline();
  const impactPilot = generatePilot();
  writeJson("impact-baseline.json", BaselineFileSchema, impactBaseline);
  writeJson("impact-pilot.json", PilotFileSchema, impactPilot);

  const fontBytes = new Uint8Array(fs.readFileSync(fontPath));
  const font = fontkit.create(Buffer.from(fontBytes));
  const missing = [...chars].filter((ch) => !font.hasGlyphForCodePoint(ch.codePointAt(0)!));
  if (missing.length > 0) {
    throw new Error(
      `フォントにない文字があります: ${missing.join("")}\nREADME.md の「図面用フォント」の手順でフォントを作り直してください`,
    );
  }
  console.log("図面PDF:");
  for (const s of DEMO_SCENARIOS) {
    for (const d of s.drawings) {
      fs.writeFileSync(path.join(samplesDir, d.fileName), await renderDrawingPdf(d, fontBytes));
      console.log(`  public/samples/${d.fileName}`);
    }
  }

  const won = cases.filter((c) => c.result === "won");
  const overrun = won.filter((c) => {
    const est = c.estimatedProcesses.reduce((s, p) => s + p.cycleHoursPerPiece, 0);
    const act = c.actualProcesses!.reduce((s, p) => s + p.cycleHoursPerPiece, 0);
    return act > est * 1.15;
  });
  const avgDays = cases.reduce((s, c) => s + c.responseDays, 0) / cases.length;
  console.log(
    `過去案件 ${cases.length}件(受注${won.length}・失注${cases.filter((c) => c.result === "lost").length})、` +
      `実績が見積を15%超えた案件 ${overrun.length}件、平均回答日数 ${avgDays.toFixed(1)}日、不具合 ${defects.length}件`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
