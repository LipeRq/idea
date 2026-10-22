import fs from "node:fs";
import path from "node:path";
import { decodeCsvBytes, parseCsvRecords } from "./lib/csv";
import { FIELD_KEYS, FIELD_LABEL } from "@/lib/domain/inquiry";
import { DimensionsSchema, NO_TREATMENT, type Dimensions } from "@/lib/domain/reference";
import type { GroundTruth } from "@/lib/demo/scenarios";
import { LIMITS, type UploadedFile } from "@/lib/pipeline";
import type { ReferenceData } from "@/lib/reference/load";

// PoC で、お客様のデータ(CSV + 図面PDF + メール本文)を評価に読み込む。
// 形式の説明は docs/evals.md と apps/quote-assist/README.md。poc-plan.md 3.2・3.4 の資料に対応している。
//
//   <フォルダ>/cases.csv        1行=1案件(正解データ)
//   <フォルダ>/drawings/*.pdf   図面PDF(cases.csv の drawings 列のファイル名)
//   <フォルダ>/emails/*.txt     引き合いメールの本文(任意。cases.csv の email_file 列。直接 email_body 列に書いてもよい)

/** CSV の列名(英語名)と、日本語の別名 */
export const COLUMNS: { key: string; aliases: string[]; required: boolean; doc: string }[] = [
  { key: "id", aliases: ["案件ID", "案件id"], required: true, doc: "案件を区別する名前(重複不可)" },
  { key: "kind", aliases: ["種類"], required: false, doc: "リピート・新規・情報不足・短納期 など(種類別の集計に使う)" },
  { key: "drawings", aliases: ["図面ファイル", "図面"], required: true, doc: "drawings/ のPDFのファイル名。複数は ; 区切り(最大3)" },
  { key: "email_file", aliases: ["メール本文ファイル"], required: false, doc: "emails/ のテキストのファイル名" },
  { key: "email_body", aliases: ["メール本文"], required: false, doc: "メール本文を直接書く(email_file の代わり)" },
  { key: "email_subject", aliases: ["件名"], required: false, doc: "メールの件名" },
  { key: "email_from", aliases: ["差出人"], required: false, doc: "差出人(顧客の特定に使う)" },
  { key: "received_at", aliases: ["受付日"], required: false, doc: "YYYY-MM-DD。「来月末」のような相対的な納期の基準日(省略時は実行日)" },
  { key: "part_name", aliases: ["品名"], required: true, doc: "正解の品名" },
  { key: "drawing_number", aliases: ["図番"], required: true, doc: "正解の図番" },
  { key: "revision", aliases: ["版"], required: true, doc: "正解の版" },
  { key: "material", aliases: ["材質"], required: false, doc: "単価表の材質の id または名前・別名。空=記載なし" },
  { key: "quantity", aliases: ["数量"], required: false, doc: "整数。空=記載なし" },
  { key: "dimensions", aliases: ["外形寸法"], required: false, doc: "block:120x60x25(長さ×幅×高さ)/ round:30x100(直径×長さ)/ sheet:200x100x2(長さ×幅×板厚)。120x60x25 は角物、φ30x100 は丸物" },
  { key: "tolerance_mm", aliases: ["最小公差"], required: false, doc: "最小公差(mm)の数値。空=記載なし" },
  { key: "surface_treatment", aliases: ["表面処理"], required: false, doc: "単価表の処理の id または名前。「なし」=処理なしと明記。空=記載なし" },
  { key: "heat_treatment", aliases: ["熱処理"], required: false, doc: "表面処理と同じ" },
  { key: "due_date", aliases: ["希望納期"], required: false, doc: "YYYY-MM-DD。この列があれば評価する(空=記載なし)" },
  { key: "inspection", aliases: ["検査書類"], required: false, doc: "検査書類の正解(例: 検査成績書)。この列があれば評価する(空=記載なし)" },
  { key: "expected_questions", aliases: ["確認すべき項目"], required: false, doc: "本来確認すべき項目。項目名(materialなど)または日本語(材質など)を ; 区切り" },
  { key: "own_case_id", aliases: ["台帳の案件ID"], required: false, doc: "見積台帳(past-cases)での、この案件自身の id。類似検索の対象から除く(答えの混入を防ぐ)" },
  { key: "similar_case_ids", aliases: ["参考にする過去案件"], required: false, doc: "見積担当者が挙げた、参考にする過去案件の台帳 id(1〜3件、; 区切り)" },
];

export type PocTruth = Omit<GroundTruth, "dimensions" | "expectedQuestions"> & {
  dimensions: Dimensions | null;
  /** undefined=評価しない(cases.csv に列がない) / null=記載なしが正解 */
  dueDate?: string | null;
  inspection?: string | null;
};

export type PocCase = {
  id: string;
  kind: string | null;
  receivedAt: string | null;
  email: { from: string; subject: string; body: string };
  drawings: UploadedFile[];
  truth: PocTruth;
  expectedQuestions: string[];
  ownCaseId: string | null;
  similarCaseIds: string[];
};

export class PocDataError extends Error {}

const norm = (s: string) => s.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
const LIST_SPLIT = /[;；]+/;
const splitList = (s: string) => s.split(LIST_SPLIT).map((x) => x.trim()).filter(Boolean);

/** 寸法の書き方(block:120x60x25 / round:30x100 / sheet:200x100x2 / 120x60x25 / φ30x100)を Dimensions にする */
export function parseDimensions(text: string): Dimensions {
  const s = text.normalize("NFKC").trim();
  const m = /^(?:(block|round|sheet|角物|丸物|板物)\s*[:：]\s*|([φΦø⌀]))?\s*(.+)$/i.exec(s);
  if (!m) throw new Error(`寸法を読めません: 「${text}」`);
  const prefix = (m[1] ?? (m[2] ? "round" : "block")).toLowerCase();
  const nums = m[3].split(/\s*[x×*]\s*/i).map((n) => Number(n.replace(/^t/i, "").replace(/mm$/i, "")));
  if (nums.some((n) => !Number.isFinite(n) || n <= 0)) throw new Error(`寸法を読めません: 「${text}」(数値を x で区切ってください)`);
  const shape = prefix === "round" || prefix === "丸物" ? "round" : prefix === "sheet" || prefix === "板物" ? "sheet" : "block";
  const need = shape === "round" ? 2 : 3;
  if (nums.length !== need) throw new Error(`寸法の数が違います: 「${text}」(${shape} は ${need} つの数値: ${shape === "round" ? "直径x長さ" : shape === "sheet" ? "長さx幅x板厚" : "長さx幅x高さ"})`);
  const dims: Dimensions =
    shape === "round"
      ? { shape, lengthMm: nums[1], widthMm: null, heightMm: null, diameterMm: nums[0] }
      : { shape, lengthMm: nums[0], widthMm: nums[1], heightMm: nums[2], diameterMm: null };
  const parsed = DimensionsSchema.safeParse(dims);
  if (!parsed.success) throw new Error(`寸法が範囲外です: 「${text}」`);
  return parsed.data;
}

/** 確認すべき項目(材質・表面処理など)を、項目のキー(material など)にそろえる */
export function parseQuestionFields(text: string): string[] {
  const byLabel = new Map<string, string>([...FIELD_KEYS.map((k) => [norm(FIELD_LABEL[k]), k] as const), ["その他", "other"], ["other", "other"]]);
  return splitList(text).map((token) => {
    const direct = (FIELD_KEYS as readonly string[]).includes(token) || token === "other" ? token : byLabel.get(norm(token));
    if (!direct) throw new Error(`確認すべき項目「${token}」が分かりません(使える項目: ${FIELD_KEYS.join(", ")}, other。日本語は ${Object.values(FIELD_LABEL).join("・")})`);
    return direct;
  });
}

function resolveMaterial(value: string, ref: ReferenceData): string {
  const v = norm(value);
  const hit = ref.rates.materials.find((m) => norm(m.id) === v || norm(m.name) === v || m.aliases.some((a) => norm(a) === v));
  if (!hit) throw new Error(`材質「${value}」が単価表にありません(単価表の材質: ${ref.rates.materials.map((m) => m.id).join(", ")})`);
  return hit.id;
}

function resolveTreatment(value: string, kind: "surface" | "heat", ref: ReferenceData): string {
  const v = norm(value);
  if (["なし", "無し", "none", NO_TREATMENT].includes(v)) return NO_TREATMENT;
  const hit = ref.rates.treatments.find((t) => t.kind === kind && (norm(t.id) === v || norm(t.name) === v || t.aliases.some((a) => norm(a) === v)));
  if (!hit) {
    const options = ref.rates.treatments.filter((t) => t.kind === kind).map((t) => t.id);
    throw new Error(`${kind === "surface" ? "表面処理" : "熱処理"}「${value}」が単価表にありません(単価表: ${options.join(", ")}、処理なしは「なし」)`);
  }
  return hit.id;
}

const isoDate = (v: string, label: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new Error(`${label}は YYYY-MM-DD で書いてください: 「${v}」`);
  return v;
};

function readInside(root: string, sub: string, name: string): string {
  const full = path.resolve(root, sub, name);
  if (!full.startsWith(path.resolve(root, sub) + path.sep)) throw new Error(`${sub}/ の外のファイルは指定できません: ${name}`);
  if (!fs.existsSync(full)) throw new Error(`${sub}/${name} がありません`);
  return full;
}

/**
 * お客様のデータを読み込む。問題はすべて集めて、行番号つきで一度に報告する(1つずつ直さなくて済むように)。
 * 参照データ(単価表)は、材質・処理の名前を id にそろえるために使う。
 */
export function loadPocDataset(dir: string, ref: ReferenceData): PocCase[] {
  const csvPath = path.join(dir, "cases.csv");
  if (!fs.existsSync(csvPath)) throw new PocDataError(`${csvPath} がありません(形式は docs/evals.md の「PoC のデータ」)`);
  const { headers, records } = parseCsvRecords(decodeCsvBytes(fs.readFileSync(csvPath)));

  const columnOf = new Map<string, string>();
  for (const c of COLUMNS) for (const name of [c.key, ...c.aliases]) columnOf.set(name.toLowerCase(), c.key);
  const present = new Map<string, string>(); // key → CSV 上の列名
  const unknown: string[] = [];
  for (const h of headers) {
    const key = columnOf.get(h.toLowerCase());
    if (key) present.set(key, h);
    else if (h) unknown.push(h);
  }
  const missing = COLUMNS.filter((c) => c.required && !present.has(c.key)).map((c) => c.key);
  if (missing.length > 0) throw new PocDataError(`cases.csv に必須の列がありません: ${missing.join(", ")}(読めた列: ${headers.join(", ")})`);
  if (unknown.length > 0) console.warn(`注意: cases.csv の次の列は使いません: ${unknown.join(", ")}`);

  const problems: string[] = [];
  const cases: PocCase[] = [];
  const seen = new Set<string>();
  records.forEach((rec, i) => {
    const line = i + 2;
    const cell = (key: string) => (present.has(key) ? rec[present.get(key)!] ?? "" : "");
    const fail = (e: unknown) => problems.push(`${line}行目(${cell("id") || "id なし"}): ${e instanceof Error ? e.message : String(e)}`);
    const attempt = <T>(fn: () => T): T | undefined => {
      try {
        return fn();
      } catch (e) {
        fail(e);
        return undefined;
      }
    };
    const id = cell("id");
    if (!id) return fail(new Error("id が空です"));
    if (seen.has(id)) return fail(new Error("id が重複しています"));
    seen.add(id);

    const drawings: UploadedFile[] = [];
    const names = splitList(cell("drawings"));
    if (names.length === 0) fail(new Error("drawings が空です"));
    if (names.length > LIMITS.maxFiles) fail(new Error(`図面は${LIMITS.maxFiles}ファイルまでです`));
    for (const name of names) {
      attempt(() => {
        const data = new Uint8Array(fs.readFileSync(readInside(dir, "drawings", name)));
        if (new TextDecoder().decode(data.subarray(0, 5)) !== "%PDF-") throw new Error(`drawings/${name} がPDFではありません`);
        drawings.push({ name, data });
      });
    }
    let body = cell("email_body");
    if (cell("email_file")) {
      const file = attempt(() => readInside(dir, "emails", cell("email_file")));
      if (file) body = decodeCsvBytes(fs.readFileSync(file));
    }
    const q = (key: string) => (cell(key) === "" ? null : cell(key));
    const quantity = attempt(() => {
      const v = cell("quantity");
      if (v === "") return null;
      const n = Number(v.normalize("NFKC").replace(/,/g, ""));
      if (!Number.isInteger(n) || n <= 0) throw new Error(`数量は正の整数にしてください: 「${v}」`);
      return n;
    });
    const tolerance = attempt(() => {
      const v = cell("tolerance_mm");
      if (v === "") return null;
      const n = Number(v.normalize("NFKC"));
      if (!Number.isFinite(n) || n <= 0) throw new Error(`最小公差は正の数(mm)にしてください: 「${v}」`);
      return n;
    });
    const truth: PocTruth = {
      partName: cell("part_name"),
      drawingNumber: cell("drawing_number"),
      revision: cell("revision"),
      materialId: attempt(() => (cell("material") === "" ? null : resolveMaterial(cell("material"), ref))) ?? null,
      quantity: quantity ?? null,
      dimensions: attempt(() => (cell("dimensions") === "" ? null : parseDimensions(cell("dimensions")))) ?? null,
      toleranceMm: tolerance ?? null,
      surfaceTreatmentId: attempt(() => (cell("surface_treatment") === "" ? null : resolveTreatment(cell("surface_treatment"), "surface", ref))) ?? null,
      heatTreatmentId: attempt(() => (cell("heat_treatment") === "" ? null : resolveTreatment(cell("heat_treatment"), "heat", ref))) ?? null,
    };
    for (const k of ["part_name", "drawing_number", "revision"] as const) if (cell(k) === "") fail(new Error(`${k} が空です(正解の値を入れてください)`));
    if (present.has("due_date")) truth.dueDate = attempt(() => (cell("due_date") === "" ? null : isoDate(cell("due_date"), "due_date"))) ?? null;
    if (present.has("inspection")) truth.inspection = q("inspection");
    const receivedAt = attempt(() => (cell("received_at") === "" ? null : isoDate(cell("received_at"), "received_at"))) ?? null;
    const expectedQuestions = attempt(() => parseQuestionFields(cell("expected_questions"))) ?? [];
    const similar = splitList(cell("similar_case_ids"));
    for (const sid of similar) if (!ref.cases.some((c) => c.id === sid)) fail(new Error(`similar_case_ids の「${sid}」が台帳(past-cases)にありません`));
    if (similar.length > 3) fail(new Error("similar_case_ids は1〜3件にしてください"));
    const own = q("own_case_id");
    if (own && !ref.cases.some((c) => c.id === own)) fail(new Error(`own_case_id の「${own}」が台帳(past-cases)にありません`));

    cases.push({
      id,
      kind: q("kind"),
      receivedAt,
      email: { from: cell("email_from"), subject: cell("email_subject"), body },
      drawings,
      truth,
      expectedQuestions,
      ownCaseId: own,
      similarCaseIds: similar,
    });
  });
  if (problems.length > 0) {
    throw new PocDataError(`cases.csv に直す点が ${problems.length} 件あります:\n${problems.slice(0, 30).map((p) => `  - ${p}`).join("\n")}${problems.length > 30 ? `\n  …ほか ${problems.length - 30} 件` : ""}`);
  }
  if (cases.length === 0) throw new PocDataError("cases.csv に案件がありません");
  return cases;
}
