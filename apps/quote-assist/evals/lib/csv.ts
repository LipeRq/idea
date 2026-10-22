// CSV(お客様が Excel から書き出したもの)の読み込み。RFC 4180 の引用符・改行・BOM に対応し、
// 文字コードは UTF-8 を試して、読めなければ Shift_JIS(Excel の既定の CSV)として読む。

export function decodeCsvBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("shift_jis").decode(bytes);
  }
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
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
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (quoted) throw new Error("CSV の引用符が閉じていません");
  row.push(cell);
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

/** ヘッダー行つきの CSV を、列名をキーにした行にする(列名の前後の空白は除く) */
export function parseCsvRecords(text: string): { headers: string[]; records: Record<string, string>[] } {
  const [head, ...body] = parseCsv(text);
  if (!head) throw new Error("CSV が空です");
  const headers = head.map((h) => h.trim());
  return { headers, records: body.map((cells) => Object.fromEntries(headers.map((h, i) => [h, (cells[i] ?? "").trim()]))) };
}

/** CSV に書き出す(カンマ・引用符・改行を含むセルは引用符で囲む) */
export function toCsv(rows: string[][]): string {
  const esc = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);
  return `${rows.map((r) => r.map(esc).join(",")).join("\n")}\n`;
}
