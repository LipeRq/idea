import { IsoDate, MAX_BASELINE_ROWS, REQUEST_KIND_LABEL, REQUEST_KINDS, type BaselineRow } from "../domain/impact";

// ベースライン(PoC計画書 5章の記録シート)のCSV取り込み・書き出し。
// Excelで作った表をそのまま貼り付けても(タブ区切り)、保存したCSV(カンマ区切り)でも読める。

export const MAX_CSV_BYTES = 512 * 1024;

/** 記録シートの列(PoC計画書 5章)+ 任意の拡張列 */
export const BASELINE_HEADERS = [
  "受付日時",
  "お客様",
  "品名・図番",
  "種類(新規/リピート/改訂)",
  "図面枚数",
  "見積担当",
  "作業時間:営業・事務(分)",
  "作業時間:見積担当(分)",
  "回答日時",
  "お客様への問い合わせ",
  "受注/失注",
  "メモ",
  "受注額(円・任意)",
  "見積原価(円・任意)",
  "実績原価(円・任意)",
  "手戻り件数(任意)",
] as const;

type Column =
  | "receivedAt"
  | "customer"
  | "partName"
  | "kind"
  | "drawingCount"
  | "estimator"
  | "salesMinutes"
  | "estimatorMinutes"
  | "answeredAt"
  | "customerInquiry"
  | "result"
  | "memo"
  | "orderAmount"
  | "quotedCost"
  | "actualCost"
  | "reworkCount";

/** 見出しの表記ゆれ(全角・半角のかっこ、空白、コロン)をそろえる */
function normalizeHeader(h: string): string {
  return h
    .normalize("NFKC")
    .replace(/[\s　]/g, "")
    .replace(/[【】]/g, "")
    .toLowerCase();
}

function columnOf(header: string): Column | null {
  const h = normalizeHeader(header);
  if (h.length === 0) return null;
  if (h.includes("受付")) return "receivedAt";
  if (h.includes("作業時間") && h.includes("営業")) return "salesMinutes";
  if (h.includes("作業時間") && h.includes("見積")) return "estimatorMinutes";
  if (h.includes("問い合わせ") || h.includes("問合せ")) return "customerInquiry";
  if (h.includes("回答")) return "answeredAt";
  if (h.includes("受注額")) return "orderAmount";
  if (h.includes("見積原価")) return "quotedCost";
  if (h.includes("実績原価")) return "actualCost";
  if (h.includes("手戻り")) return "reworkCount";
  if (h.includes("受注") || h.includes("失注")) return "result";
  if (h.includes("見積担当")) return "estimator";
  if (h.includes("図面")) return "drawingCount";
  if (h.includes("品名") || h.includes("図番")) return "partName";
  if (h.startsWith("種類")) return "kind";
  if (h.startsWith("お客様") || h.startsWith("顧客")) return "customer";
  if (h.startsWith("メモ") || h.startsWith("備考")) return "memo";
  return null;
}

/** 区切り文字(カンマかタブ)を、先頭行から決める */
function detectDelimiter(text: string): string {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  return (first.match(/\t/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? "\t" : ",";
}

/** CSVの解析(引用符・引用符内の改行・CRLF・BOM に対応) */
export function parseCsv(text: string, delimiter = detectDelimiter(text)): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// ---- 値の読み取り ----

const BLANK = new Set(["", "-", "—", "−", "未定", "不明", "なし(未入力)"]);
const isBlank = (v: string) => BLANK.has(v.trim()) || /^【.*】$/.test(v.trim());

class CellError extends Error {}

/** 2026-07-06 / 2026/7/6 9:30 / 2026年7月6日 → 2026-07-06(時刻は営業日の計算に使わないので保存しない) */
export function parseDate(value: string): string | null {
  const v = value.normalize("NFKC").trim();
  if (isBlank(v)) return null;
  const m = v.match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?(?:[\sT].*)?$/);
  if (!m) throw new CellError("日付は 2026-07-06 や 2026/7/6 9:30 の形で入力してください");
  const iso = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  if (!IsoDate.safeParse(iso).success || new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) !== iso) {
    throw new CellError(`存在しない日付です(${value.trim()})`);
  }
  return iso;
}

function parseNumber(value: string, label: string, integer = false): number | null {
  // 「45(推定)」のように、推定の印がついた値も数として読む(印は行のメモに残す)
  const v = value.normalize("NFKC").trim().replace(/推定|[(),\s円分件枚]/g, "");
  if (isBlank(v)) return null;
  if (!/^\d+(\.\d+)?$/.test(v)) throw new CellError(`${label}は0以上の数で入力してください(${value.trim()})`);
  const n = Number(v);
  if (integer && !Number.isInteger(n)) throw new CellError(`${label}は整数で入力してください(${value.trim()})`);
  return n;
}

function parseKind(value: string): BaselineRow["kind"] {
  const v = value.normalize("NFKC").trim();
  if (isBlank(v)) return null;
  const hit = REQUEST_KINDS.find((k) => REQUEST_KIND_LABEL[k] === v || k === v.toLowerCase());
  if (!hit) throw new CellError("種類は 新規・リピート・改訂 のどれかで入力してください");
  return hit;
}

function parseResult(value: string): BaselineRow["result"] {
  const v = value.normalize("NFKC").trim();
  if (isBlank(v)) return null;
  if (["受注", "won", "○", "〇"].includes(v)) return "won";
  if (["失注", "lost", "×"].includes(v)) return "lost";
  throw new CellError("受注/失注は 受注・失注 のどちらか(結果が未定なら空欄)で入力してください");
}

function parseInquiry(value: string): boolean | null {
  const v = value.normalize("NFKC").trim();
  if (isBlank(v)) return null;
  if (["あり", "有", "有り", "はい", "yes", "true", "○", "〇"].includes(v.toLowerCase())) return true;
  if (["なし", "無", "無し", "いいえ", "no", "false", "×"].includes(v.toLowerCase())) return false;
  throw new CellError("お客様への問い合わせは あり・なし で入力してください");
}

// ---- 取り込み ----

export type CsvImportError = { line: number; message: string };
export type CsvImportResult = {
  rows: BaselineRow[];
  errors: CsvImportError[];
  /** 行ごとの誤りがなく、取り込める */
  ok: boolean;
};

/**
 * 記録シートのCSVを読む。見出し行が必要で、列の順番は問わない。
 * 誤りのある行は取り込まず、行番号つきで返す(ほかの行は取り込む)。
 */
export function parseBaselineCsv(text: string): CsvImportResult {
  const errors: CsvImportError[] = [];
  if (new TextEncoder().encode(text).byteLength > MAX_CSV_BYTES) {
    return { rows: [], errors: [{ line: 0, message: "ファイルが大きすぎます(512KBまで)" }], ok: false };
  }
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], errors: [{ line: 0, message: "データがありません" }], ok: false };

  const header = table[0].map(columnOf);
  if (!header.includes("receivedAt")) {
    return { rows: [], errors: [{ line: 1, message: "見出し行に「受付日時」の列が見つかりません" }], ok: false };
  }
  const dup = header.find((c, i) => c !== null && header.indexOf(c) !== i);
  if (dup) return { rows: [], errors: [{ line: 1, message: "同じ意味の列が2つあります。見出しを確かめてください" }], ok: false };

  const rows: BaselineRow[] = [];
  const dataRows = table.slice(1);
  if (dataRows.length > MAX_BASELINE_ROWS) {
    errors.push({ line: 0, message: `取り込めるのは${MAX_BASELINE_ROWS}行までです(超えた分は取り込みません)` });
  }
  dataRows.slice(0, MAX_BASELINE_ROWS).forEach((cells, i) => {
    const line = i + 2;
    const get = (col: Column) => {
      const idx = header.indexOf(col);
      return idx >= 0 ? (cells[idx] ?? "") : "";
    };
    try {
      const receivedAt = parseDate(get("receivedAt"));
      if (!receivedAt) throw new CellError("受付日時が空欄です");
      const answeredAt = parseDate(get("answeredAt"));
      const text = (col: Column, max: number) => get(col).trim().slice(0, max);
      const estimated = (["salesMinutes", "estimatorMinutes"] as const).some((c) => get(c).includes("推定"));
      const memo = text("memo", 200);
      rows.push({
        receivedAt,
        customer: text("customer", 100),
        partName: text("partName", 100),
        kind: parseKind(get("kind")),
        drawingCount: parseNumber(get("drawingCount"), "図面枚数", true),
        estimator: isBlank(get("estimator")) ? "" : text("estimator", 50),
        salesMinutes: parseNumber(get("salesMinutes"), "作業時間:営業・事務"),
        estimatorMinutes: parseNumber(get("estimatorMinutes"), "作業時間:見積担当"),
        answeredAt,
        customerInquiry: parseInquiry(get("customerInquiry")),
        result: parseResult(get("result")),
        memo: estimated && !memo.includes("推定") ? `${memo} 推定`.trim().slice(0, 200) : memo,
        orderAmount: parseNumber(get("orderAmount"), "受注額"),
        quotedCost: parseNumber(get("quotedCost"), "見積原価"),
        actualCost: parseNumber(get("actualCost"), "実績原価"),
        reworkCount: parseNumber(get("reworkCount"), "手戻り件数", true),
      });
    } catch (e) {
      if (!(e instanceof CellError)) throw e;
      errors.push({ line, message: e.message });
    }
  });
  return { rows, errors, ok: errors.length === 0 };
}

// ---- 書き出し ----

/** 表計算ソフトが式として実行する先頭文字(= + - @ タブ 改行)を無害にする(数値でない文字列のみ) */
function safeText(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

export function csvCell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "number" ? String(v) : typeof v === "boolean" ? (v ? "あり" : "なし") : safeText(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(table: readonly (readonly (string | number | boolean | null | undefined)[])[]): string {
  return `﻿${table.map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** 取り込み用の見出しだけのCSV(Excelで開いて記入する) */
export function baselineTemplateCsv(): string {
  return toCsv([BASELINE_HEADERS]);
}

export function baselineToCsv(rows: readonly BaselineRow[]): string {
  return toCsv([
    BASELINE_HEADERS,
    ...rows.map((r) => [
      r.receivedAt,
      r.customer,
      r.partName,
      r.kind ? REQUEST_KIND_LABEL[r.kind] : "",
      r.drawingCount,
      r.estimator,
      r.salesMinutes,
      r.estimatorMinutes,
      r.answeredAt,
      r.customerInquiry,
      r.result === "won" ? "受注" : r.result === "lost" ? "失注" : "",
      r.memo,
      r.orderAmount,
      r.quotedCost,
      r.actualCost,
      r.reworkCount,
    ]),
  ]);
}
