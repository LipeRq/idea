import fs from "node:fs";
import path from "node:path";
import { toCsv } from "./lib/csv";
import { COLUMNS, type PocCase } from "./poc-data";
import { todayJst } from "@/lib/dates";
import { DEMO_SCENARIOS } from "@/lib/demo/scenarios";
import type { Dimensions } from "@/lib/domain/reference";
import type { ReferenceData } from "@/lib/reference/load";

// デモ用の引き合い3件を、PoC のデータの形式(cases.csv + drawings/ + emails/)で書き出す。
// 形式の見本と、読み込みの動作確認(npm run eval -- --data <フォルダ> --demo)に使う。

const dimText = (d: Dimensions | null) =>
  d === null ? "" : d.shape === "round" ? `round:${d.diameterMm}x${d.lengthMm}` : `${d.shape}:${d.lengthMm}x${d.widthMm}x${d.heightMm}`;

const kindOf = { revision: "リピート・改訂品", "missing-info": "情報不足", "short-lead": "短納期・特殊工程" } as const;

export function exportDemoDataset(dir: string, ref: ReferenceData, samplesDir = path.join(process.cwd(), "public", "samples"), today = todayJst()): PocCase["id"][] {
  fs.mkdirSync(path.join(dir, "drawings"), { recursive: true });
  fs.mkdirSync(path.join(dir, "emails"), { recursive: true });
  const header = COLUMNS.map((c) => c.key).filter((k) => !["due_date", "inspection", "own_case_id", "email_body"].includes(k));
  const rows: string[][] = [header];
  for (const s of DEMO_SCENARIOS) {
    const email = s.buildEmail(today);
    for (const d of s.drawings) fs.copyFileSync(path.join(samplesDir, d.fileName), path.join(dir, "drawings", d.fileName));
    fs.writeFileSync(path.join(dir, "emails", `${s.id}.txt`), email.body);
    // 参考にする過去案件: 同じ図番の台帳の案件(デモでは MS-24017 の旧版だけ)
    const similar = ref.cases.filter((c) => c.drawingNumber === s.truth.drawingNumber).map((c) => c.id);
    const t = s.truth;
    const values: Record<string, string> = {
      id: s.id,
      kind: kindOf[s.id],
      drawings: [...new Set(s.drawings.map((d) => d.fileName))].join(";"),
      email_file: `${s.id}.txt`,
      email_subject: email.subject,
      email_from: email.from,
      received_at: today,
      part_name: t.partName,
      drawing_number: t.drawingNumber,
      revision: t.revision,
      material: t.materialId ?? "",
      quantity: t.quantity === null ? "" : String(t.quantity),
      dimensions: dimText(t.dimensions),
      tolerance_mm: t.toleranceMm === null ? "" : String(t.toleranceMm),
      surface_treatment: t.surfaceTreatmentId === "none" ? "なし" : (t.surfaceTreatmentId ?? ""),
      heat_treatment: t.heatTreatmentId === "none" ? "なし" : (t.heatTreatmentId ?? ""),
      expected_questions: t.expectedQuestions.join(";"),
      similar_case_ids: similar.join(";"),
    };
    rows.push(header.map((h) => values[h] ?? ""));
  }
  fs.writeFileSync(path.join(dir, "cases.csv"), toCsv(rows));
  return DEMO_SCENARIOS.map((s) => s.id);
}
