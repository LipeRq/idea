// .xls(BIFF8)の Workbook ストリームから、シート一覧・使用範囲・数式の件数・名前定義・外部ブック参照を読む。
import type { DefinedName, ExcelInfo, ExternalLink, Sheet } from "../schema";
import { Budget } from "../limits";
import { maskSecrets } from "../secrets";
import { rangeRef } from "./common";

const BOF = 0x0809;
const EOF = 0x000a;
const BOUNDSHEET = 0x0085;
const NAME = 0x0018;
const SUPBOOK = 0x01ae;
const DIMENSIONS = 0x0200;
const FORMULA = 0x0006;
const FILEPASS = 0x002f;
const CODENAME = 0x01ba;

const BUILTIN_NAMES = [
  "Consolidate_Area",
  "Auto_Open",
  "Auto_Close",
  "Extract",
  "Database",
  "Criteria",
  "Print_Area",
  "Print_Titles",
  "Recorder",
  "Data_Form",
  "Auto_Activate",
  "Auto_Deactivate",
  "Sheet_Title",
  "_FilterDatabase",
];

export interface XlsWorkbook {
  excel: ExcelInfo;
  codeNames: Map<string, string>;
}

interface Rec {
  type: number;
  data: Uint8Array;
  offset: number;
}

function* records(buf: Uint8Array, start = 0, budget?: Budget): Generator<Rec> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let pos = start;
  while (pos + 4 <= buf.length) {
    budget?.check();
    const type = view.getUint16(pos, true);
    const len = view.getUint16(pos + 2, true);
    if (pos + 4 + len > buf.length) return;
    yield { type, data: buf.subarray(pos + 4, pos + 4 + len), offset: pos };
    pos += 4 + len;
  }
}

const u16 = (d: Uint8Array, at: number) => d[at] | (d[at + 1] << 8);
const u32 = (d: Uint8Array, at: number) => new DataView(d.buffer, d.byteOffset + at, 4).getUint32(0, true);

/** fHighByte 付きの文字列本体(BIFF8)。圧縮時は UTF-16 の下位バイトだけが並ぶ */
function readChars(d: Uint8Array, at: number, cch: number): { text: string; end: number } {
  const high = (d[at] & 0x01) !== 0;
  const start = at + 1;
  if (high) {
    const bytes = d.subarray(start, start + cch * 2);
    return { text: new TextDecoder("utf-16le").decode(bytes), end: start + cch * 2 };
  }
  let text = "";
  for (let i = 0; i < cch && start + i < d.length; i++) text += String.fromCharCode(d[start + i]);
  return { text, end: start + cch };
}

export function parseXlsWorkbook(stream: Uint8Array, warnings: string[], budget: Budget = new Budget()): XlsWorkbook {
  const codeNames = new Map<string, string>();
  const empty: ExcelInfo = {
    sheets: [],
    definedNames: [],
    externalLinks: [],
    connections: [],
    controlMacros: [],
    formulaCount: 0,
    formulaTextAvailable: false,
  };

  const first = records(stream).next().value;
  if (!first || first.type !== BOF || u16(first.data, 0) !== 0x0600) {
    warnings.push("BIFF8 以外の .xls(Excel 95 以前)のため、シート情報は解析していません");
    return { excel: empty, codeNames };
  }

  const bound: { name: string; offset: number; state: number; dt: number }[] = [];
  const rawNames: { name: string; itab: number; flags: number }[] = [];
  const externalLinks: ExternalLink[] = [];
  let encrypted = false;

  for (const rec of records(stream, 0, budget)) {
    if (rec.offset > 0 && rec.type === EOF) break; // ブック全体(globals)の終わり
    const d = rec.data;
    if (rec.type === FILEPASS) {
      encrypted = true;
      break;
    } else if (rec.type === BOUNDSHEET && d.length >= 8) {
      const { text } = readChars(d, 7, d[6]);
      bound.push({ name: text, offset: u32(d, 0), state: d[4] & 0x03, dt: d[5] });
    } else if (rec.type === NAME && d.length >= 15) {
      const flags = u16(d, 0);
      const cch = d[3];
      const itab = u16(d, 8);
      const builtIn = (flags & 0x20) !== 0;
      const { text } = readChars(d, 14, cch);
      const name = builtIn && text.length === 1 ? (BUILTIN_NAMES[text.charCodeAt(0)] ?? text) : text;
      rawNames.push({ name, itab, flags });
    } else if (rec.type === SUPBOOK && d.length >= 4) {
      const cch = u16(d, 2);
      if (cch === 0x0401 || cch === 0x3a01) continue; // 自ブック・アドイン関数
      const { text, end } = readChars(d, 4, cch);
      const sheetNames: string[] = [];
      let p = end;
      for (let i = 0; i < u16(d, 0) && p + 3 <= d.length; i++) {
        const s = readChars(d, p + 2, u16(d, p));
        sheetNames.push(s.text);
        p = s.end;
      }
      if (externalLinks.length < budget.limits.maxListItems) {
        externalLinks.push({ index: externalLinks.length + 1, type: "workbook", target: maskSecrets(decodeVirtualPath(text)), sheetNames });
      }
    } else if (rec.type === CODENAME && d.length >= 3) {
      codeNames.set(readChars(d, 2, u16(d, 0)).text.toLowerCase(), "ブック");
    }
  }

  if (encrypted) {
    warnings.push("ブックが読み取りパスワードで暗号化されているため、シート情報は解析していません(VBAは解析対象)");
    return { excel: empty, codeNames };
  }

  // 各シートのサブストリームを読む。壊れたファイルで同じ位置を何度も指していても、同じ範囲は1回だけ読む。
  // また、読んだバイト数の合計がストリームの数倍を超えたら(シートの位置が重なり合っているなど)打ち切る
  const scanned = new Map<number, { usedRange: string | null; formulaCount: number; codeName: string | null }>();
  let scannedBytes = 0;
  let truncated = false;
  const scanSheet = (offset: number) => {
    const cached = scanned.get(offset);
    if (cached) return cached;
    let usedRange: string | null = null;
    let formulaCount = 0;
    let codeName: string | null = null;
    if (!truncated) {
      for (const rec of records(stream, offset, budget)) {
        scannedBytes += 4 + rec.data.length;
        if (scannedBytes > stream.length * 4 + 1_000_000) {
          truncated = true;
          warnings.push("シートの位置情報が不正なため、一部のシートは使用範囲・数式の件数を読んでいません");
          break;
        }
        if (rec.type === EOF || (rec.type === BOF && rec.offset !== offset)) break;
        const d = rec.data;
        if (rec.type === FORMULA) formulaCount++;
        else if (rec.type === DIMENSIONS && d.length >= 12) {
          usedRange = rangeRef(u32(d, 0), u32(d, 4) - 1, u16(d, 8), u16(d, 10) - 1);
        } else if (rec.type === CODENAME && d.length >= 3) {
          codeName = readChars(d, 2, u16(d, 0)).text;
        }
      }
    }
    const result = { usedRange, formulaCount, codeName };
    scanned.set(offset, result);
    return result;
  };

  const sheets: Sheet[] = budget.cap(bound, budget.limits.maxSheets, warnings, "シート").map((b, index) => {
    const { usedRange, formulaCount, codeName } = scanSheet(b.offset);
    if (codeName) codeNames.set(codeName.toLowerCase(), `シート「${b.name}」`);
    return {
      name: b.name,
      codeName,
      index,
      kind: b.dt === 1 ? "macrosheet" : b.dt === 2 ? "chartsheet" : "worksheet",
      state: b.state === 1 ? "hidden" : b.state === 2 ? "veryHidden" : "visible",
      usedRange,
      formulaCount,
      formulaSamples: [],
      externalRefCount: 0,
      brokenRefCount: 0,
    };
  });

  const definedNames: DefinedName[] = budget.cap(rawNames, budget.limits.maxListItems, warnings, "名前定義").map((n) => ({
    name: n.name,
    scope: n.itab > 0 ? (sheets[n.itab - 1]?.name ?? String(n.itab)) : null,
    refersTo: null,
    hidden: (n.flags & 0x01) !== 0,
    builtIn: (n.flags & 0x20) !== 0,
  }));

  return {
    excel: {
      sheets,
      definedNames,
      externalLinks,
      connections: [],
      controlMacros: [],
      formulaCount: sheets.reduce((s, x) => s + x.formulaCount, 0),
      formulaTextAvailable: false,
    },
    codeNames,
  };
}

/** [MS-XLS] 2.5.277 VirtualPath の符号化されたパスを読める形に戻す */
export function decodeVirtualPath(path: string): string {
  if (!path.startsWith("\u0001")) return path;
  let out = "";
  for (let i = 1; i < path.length; i++) {
    const c = path.charCodeAt(i);
    if (c === 0x01) {
      const v = path[++i];
      out += v === "@" ? "\\\\" : `${v}:\\`;
    } else if (c === 0x02 || c === 0x03) {
      out += "\\";
    } else if (c === 0x04) {
      out += "..\\";
    } else if (c === 0x05) {
      const len = path.charCodeAt(++i);
      out += path.slice(i + 1, i + 1 + len);
      i += len;
    } else if (c === 0x06 || c === 0x07 || c === 0x08) {
      out += "<Excelの起動フォルダ>\\";
    } else {
      out += path[i];
    }
  }
  return out;
}
