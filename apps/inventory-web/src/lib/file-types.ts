// ファイルを読み込む前(File.name と File.size だけ)の確認。
import { formatFileSize, MAX_FILE_BYTES } from "./browser-limits";

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

export type Precheck<T> = { ok: true; file: T } | { ok: false; message: string };

/** 選ばれたファイル(1件だけ解析する)を確かめる。問題があれば読み込まずに理由を返す */
export function precheckFiles<T extends { name: string; size: number }>(files: readonly T[]): Precheck<T> | null {
  if (files.length === 0) return null;
  if (files.length > 1) {
    return { ok: false, message: `一度に解析できるのは1ファイルです(${files.length}件が選ばれました)。1つだけ選んでください。` };
  }
  const file = files[0];
  const ext = extensionOf(file.name);
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    return {
      ok: false,
      message: `この形式(${ext || "拡張子なし"})には対応していません。対応している形式: ${SUPPORTED_FORMATS_TEXT}`,
    };
  }
  if (file.size === 0) {
    return { ok: false, message: "ファイルが空です(0バイト)。Excel / Access で保存し直したファイルを選んでください。" };
  }
  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      message: `ファイルが大きすぎます(${formatFileSize(file.size)}。上限は${formatFileSize(MAX_FILE_BYTES)})。マクロの解析にデータは不要です。データの行を消したコピーを保存してお試しください。`,
    };
  }
  return { ok: true, file };
}
