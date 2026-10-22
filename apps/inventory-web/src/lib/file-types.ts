// ファイルを読み込む前(File.name と File.size だけ)の確認。
import { formatFileSize, MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES } from "./browser-limits";

export const EXCEL_EXTENSIONS = [".xlsm", ".xlsb", ".xls", ".xlsx", ".xlam", ".xltm"] as const;
export const ACCESS_EXTENSIONS = [".accdb", ".mdb"] as const;
export const SUPPORTED_EXTENSIONS: readonly string[] = [...EXCEL_EXTENSIONS, ...ACCESS_EXTENSIONS];

/** <input type="file"> の accept */
export const ACCEPT_ATTRIBUTE = SUPPORTED_EXTENSIONS.join(",");

export const SUPPORTED_FORMATS_TEXT = `Excel(${EXCEL_EXTENSIONS.join(" ")})、Access(${ACCESS_EXTENSIONS.join(" ")})`;

export function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot).toLowerCase() : "";
}

/** 1ファイルの確認結果。problem があれば、そのファイルだけ解析せずに除外する */
export interface PrecheckEntry<T> {
  file: T;
  problem: string | null;
}

export type Precheck<T> = { ok: true; entries: PrecheckEntry<T>[] } | { ok: false; message: string };

function problemOf(file: { name: string; size: number }): string | null {
  const ext = extensionOf(file.name);
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    return `この形式(${ext || "拡張子なし"})には対応していません。対応している形式: ${SUPPORTED_FORMATS_TEXT}`;
  }
  if (file.size === 0) return "ファイルが空です(0バイト)。Excel / Access で保存し直したファイルを選んでください。";
  if (file.size > MAX_FILE_BYTES) {
    return `ファイルが大きすぎます(${formatFileSize(file.size)}。上限は${formatFileSize(MAX_FILE_BYTES)})。マクロの解析にデータは不要です。データの行を消したコピーを保存してお試しください。`;
  }
  return null;
}

/**
 * 選ばれたファイル(最大10件)を、読み込む前に確かめる(File.name と File.size だけを使う)。
 * - 11件以上、または合計が500MBを超えるときは、何も始めない
 * - 対応外・空・大きすぎるファイルは、そのファイルだけ除外する(他は解析する)
 * - 解析できるファイルが1つも無いときは、理由を返す
 */
export function precheckFiles<T extends { name: string; size: number }>(files: readonly T[]): Precheck<T> | null {
  if (files.length === 0) return null;
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (files.length > MAX_FILES || total > MAX_TOTAL_BYTES) {
    return {
      ok: false,
      message: `一度に解析できるのは${MAX_FILES}ファイル・合計${formatFileSize(MAX_TOTAL_BYTES)}までです(${files.length}ファイル・合計${formatFileSize(total)}が選ばれました)。数を減らして、もう一度選んでください。`,
    };
  }
  const entries = files.map((file) => ({ file, problem: problemOf(file) }));
  if (entries.every((e) => e.problem !== null)) {
    if (entries.length === 1) return { ok: false, message: entries[0].problem! };
    return { ok: false, message: ["解析できるファイルがありませんでした。", ...entries.map((e) => `${e.file.name}: ${e.problem}`)].join("\n") };
  }
  return { ok: true, entries };
}
