// 棚卸し一覧(複数ファイルの結果)の行・ファイル間の関係図・保存する形式(CSV / Markdown / HTML)。
// 画面のコードと同じバンドルに入るため、エンジンの実行コードには依存しない。
import type { AiResult } from "@/components/result/types";
import type { AnalysisResult } from "@/worker/protocol";
import { describeFailure, type Failure } from "./errors";
import { escapeHtml } from "./export";
import { buildFileGraph, EXTERNAL_REF_KIND_LABEL, summarizeExternalRefs, type FileGraph } from "./external-refs";

/** 1ファイルの結果(複数ファイルの一覧の1行) */
export type InventoryItem =
  | { id: string; fileName: string; outcome: "done"; result: AnalysisResult; ai: AiResult | null }
  | { id: string; fileName: string; outcome: "failed"; failure: Failure }
  | { id: string; fileName: string; outcome: "skipped"; reason: string };

export type InventoryRowStatus = "解析済み" | "エラー" | "対象外";

export interface InventoryRow {
  id: string;
  fileName: string;
  status: InventoryRowStatus;
  /** エラー・対象外の理由 */
  note: string;
  formatLabel: string;
  /** S / M / L / XL */
  size: string;
  modules: number | null;
  procedures: number | null;
  codeLines: number | null;
  sheets: number | null;
  formulas: number | null;
  tables: number | null;
  queries: number | null;
  high: number | null;
  medium: number | null;
  low: number | null;
  difficulty: string;
  externalSummary: string;
  externalCount: number | null;
  /** 参照先の一覧(例: 売上.xlsm(他のブック・マクロで開く)) */
  externalList: string[];
}

export function toRow(item: InventoryItem): InventoryRow {
  if (item.outcome !== "done") {
    const note = item.outcome === "failed" ? (() => {
      const t = describeFailure(item.failure);
      return `${t.title} ${t.hint}`;
    })() : item.reason;
    return {
      id: item.id, fileName: item.fileName, status: item.outcome === "failed" ? "エラー" : "対象外", note, formatLabel: "", size: "",
      modules: null, procedures: null, codeLines: null, sheets: null, formulas: null, tables: null, queries: null,
      high: null, medium: null, low: null, difficulty: "", externalSummary: "", externalCount: null, externalList: [],
    };
  }
  const { report: r, derived: d } = item.result;
  const isAccess = r.file.kind === "access";
  return {
    id: item.id,
    fileName: item.fileName,
    status: "解析済み",
    note: "",
    formatLabel: d.formatLabel,
    size: d.complexity.size,
    modules: r.stats.moduleCount,
    procedures: r.stats.procedureCount,
    codeLines: r.stats.codeLineCount,
    sheets: isAccess ? null : r.stats.sheetCount,
    formulas: isAccess ? null : r.stats.formulaCount,
    tables: isAccess ? r.stats.tableCount : null,
    queries: isAccess ? r.stats.queryCount : null,
    high: d.findingCounts.high,
    medium: d.findingCounts.medium,
    low: d.findingCounts.low,
    difficulty: d.complexity.level,
    externalSummary: summarizeExternalRefs(d.externalRefs),
    externalCount: d.externalRefs.length,
    externalList: d.externalRefs.map((e) => `${e.name}(${EXTERNAL_REF_KIND_LABEL[e.kind]}・${e.via.join("・")})`),
  };
}

export function toRows(items: readonly InventoryItem[]): InventoryRow[] {
  return items.map(toRow);
}

/** 解析できたファイルどうしの、他のブック・Access・DB への参照を図にする */
export function graphOf(items: readonly InventoryItem[]): FileGraph | null {
  return buildFileGraph(
    items.flatMap((i) => (i.outcome === "done" ? [{ name: i.fileName, kind: i.result.report.file.kind, refs: i.result.derived.externalRefs }] : [])),
  );
}

export interface ListSummary {
  total: number;
  done: number;
  failed: number;
  skipped: number;
  highRisk: number;
  highDifficulty: number;
}

export function summarize(rows: readonly InventoryRow[]): ListSummary {
  return {
    total: rows.length,
    done: rows.filter((r) => r.status === "解析済み").length,
    failed: rows.filter((r) => r.status === "エラー").length,
    skipped: rows.filter((r) => r.status === "対象外").length,
    highRisk: rows.reduce((sum, r) => sum + (r.high ?? 0), 0),
    highDifficulty: rows.filter((r) => r.difficulty === "高").length,
  };
}

// ---- 保存する形式 ----

const num = (v: number | null) => (v === null ? "" : String(v));

const CSV_HEADER = [
  "ファイル名", "状態", "形式", "規模", "モジュール", "プロシージャ", "コード行", "シート", "数式", "テーブル", "クエリ",
  "リスク高", "リスク中", "リスク低", "移行難易度", "外部依存の件数", "外部依存の内訳", "参照先", "備考",
];

/** CSV のセル。= + - @ で始まる文字列は、表計算ソフトが式として実行しないよう ' を付ける */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** 表計算ソフト(Excel)で文字化けしないよう、先頭に BOM を付けた UTF-8 の CSV */
export function inventoryCsv(rows: readonly InventoryRow[]): string {
  const lines = [CSV_HEADER, ...rows.map((r) => [
    r.fileName, r.status, r.formatLabel, r.size, num(r.modules), num(r.procedures), num(r.codeLines), num(r.sheets), num(r.formulas),
    num(r.tables), num(r.queries), num(r.high), num(r.medium), num(r.low), r.difficulty, num(r.externalCount), r.externalSummary,
    r.externalList.join(" / "), r.note,
  ])];
  return `\uFEFF${lines.map((line) => line.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

const mdCell = (v: string) => v.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");

const stamp = (d: Date) =>
  d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export function inventoryMarkdown(rows: readonly InventoryRow[], graph: FileGraph | null, now = new Date()): string {
  const s = summarize(rows);
  const out: string[] = [
    "# 棚卸し一覧",
    "",
    `作成日時: ${stamp(now)}`,
    "",
    `${s.total} ファイル(解析できた: ${s.done}、エラー: ${s.failed}、対象外: ${s.skipped})。リスク「高」は合計 ${s.highRisk} 件、移行難易度「高」は ${s.highDifficulty} ファイルです。`,
    "",
    "| ファイル名 | 状態 | 形式 | 規模 | モジュール | コード行 | テーブル | クエリ | リスク高 | リスク中 | リスク低 | 移行難易度 | 外部依存 |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |",
    ...rows.map((r) =>
      `| ${mdCell(r.fileName)} | ${r.status} | ${mdCell(r.formatLabel)} | ${r.size} | ${num(r.modules)} | ${num(r.codeLines)} | ${num(r.tables)} | ${num(r.queries)} | ${num(r.high)} | ${num(r.medium)} | ${num(r.low)} | ${r.difficulty} | ${mdCell(r.externalSummary)} |`,
    ),
    "",
  ];
  const notes = rows.filter((r) => r.note);
  if (notes.length > 0) {
    out.push("## 解析できなかったファイル", "", ...notes.map((r) => `- ${r.fileName}(${r.status}): ${r.note.replace(/[\r\n]+/g, " ")}`), "");
  }
  const refs = rows.filter((r) => r.externalList.length > 0);
  if (refs.length > 0) {
    out.push("## 外部への参照", "", ...refs.map((r) => `- ${r.fileName} → ${r.externalList.join("、")}`), "");
  }
  out.push("## ファイル間のつながり", "");
  if (graph) {
    out.push("```mermaid", graph.code, "```", "");
    if (graph.omitted > 0) out.push(`参照先が多いため、${graph.omitted} 件は図に出していません。`, "");
  } else {
    out.push("ファイルどうしの参照(他のブックや Access ファイルへの参照)は見つかりませんでした。", "");
  }
  out.push("---", "", "解析結果から機械的に決めた目安です(移行難易度は規模・外部とのつながり・入力画面・環境への依存から決めています)。");
  return `${out.join("\n")}\n`;
}

/** 単体 HTML の本文。svg は図の SVG(描けなかったときは null でコードを示す)。スクリプトは入れない */
export function inventoryHtmlBody(rows: readonly InventoryRow[], graph: FileGraph | null, svg: string | null, now = new Date()): string {
  const s = summarize(rows);
  const th = (t: string) => `<th>${escapeHtml(t)}</th>`;
  const td = (t: string, right = false) => `<td${right ? ' style="text-align:right"' : ""}>${escapeHtml(t)}</td>`;
  const body = rows
    .map(
      (r) =>
        `<tr>${td(r.fileName)}${td(r.status)}${td(r.formatLabel)}${td(r.size)}${td(num(r.modules), true)}${td(num(r.codeLines), true)}${td(num(r.tables), true)}${td(num(r.queries), true)}${td(num(r.high), true)}${td(num(r.medium), true)}${td(num(r.low), true)}${td(r.difficulty)}${td(r.externalSummary)}</tr>`,
    )
    .join("\n");
  const notes = rows.filter((r) => r.note);
  const refs = rows.filter((r) => r.externalList.length > 0);
  return [
    "<h1>棚卸し一覧</h1>",
    `<p>作成日時: ${escapeHtml(stamp(now))}</p>`,
    `<p>${s.total} ファイル(解析できた: ${s.done}、エラー: ${s.failed}、対象外: ${s.skipped})。リスク「高」は合計 ${s.highRisk} 件、移行難易度「高」は ${s.highDifficulty} ファイルです。</p>`,
    `<table><thead><tr>${["ファイル名", "状態", "形式", "規模", "モジュール", "コード行", "テーブル", "クエリ", "リスク高", "リスク中", "リスク低", "移行難易度", "外部依存"].map(th).join("")}</tr></thead><tbody>\n${body}\n</tbody></table>`,
    notes.length > 0
      ? `<h2>解析できなかったファイル</h2><ul>${notes.map((r) => `<li>${escapeHtml(r.fileName)}(${r.status}): ${escapeHtml(r.note.replace(/[\r\n]+/g, " "))}</li>`).join("")}</ul>`
      : "",
    refs.length > 0 ? `<h2>外部への参照</h2><ul>${refs.map((r) => `<li>${escapeHtml(r.fileName)} → ${escapeHtml(r.externalList.join("、"))}</li>`).join("")}</ul>` : "",
    "<h2>ファイル間のつながり</h2>",
    graph
      ? svg
        ? `<div class="mermaid-src">${svg}</div>`
        : `<div class="mermaid-src"><p>図を表示できませんでした。図のコードを示します(Mermaid に対応したエディタで図として表示できます)。</p><pre>${escapeHtml(graph.code)}</pre></div>`
      : "<p>ファイルどうしの参照(他のブックや Access ファイルへの参照)は見つかりませんでした。</p>",
    "<p>解析結果から機械的に決めた目安です(移行難易度は規模・外部とのつながり・入力画面・環境への依存から決めています)。</p>",
  ].join("\n");
}
