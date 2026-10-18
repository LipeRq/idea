// .xls(OLE複合ファイル)全体の読み取り: Workbook ストリーム、VBA(_VBA_PROJECT_CUR)、文書プロパティ。
import CFB, { type CFB$Container } from "cfb";
import { UnsupportedFileError } from "../errors";
import type { ExcelInfo, Properties } from "../schema";
import { decodeText } from "../vba/codepage";
import { cfbStorage, extractVbaProject, type RawVbaProject } from "../vba/project";
import { EMPTY_PROPERTIES } from "./common";
import { parseXlsWorkbook } from "./xls";

export interface XlsFile {
  excel: ExcelInfo;
  vba: RawVbaProject | null;
  properties: Properties;
  codeNames: Map<string, string>;
}

export function parseXls(container: CFB$Container, warnings: string[]): XlsFile {
  const stream = streamOf(container, "Workbook") ?? streamOf(container, "Book");
  if (!stream) throw new UnsupportedFileError("Excelのブックとして読み込めませんでした(Workbook ストリームがありません)");
  const { excel, codeNames } = parseXlsWorkbook(stream, warnings);
  warnings.push(".xls 形式では数式の件数のみを数え、式の内容とボタンへのマクロ登録は取り出していません");

  let vba: RawVbaProject | null = null;
  try {
    vba = extractVbaProject(cfbStorage(container, "_VBA_PROJECT_CUR"), warnings);
  } catch (e) {
    warnings.push(`VBAプロジェクトを読めませんでした: ${(e as Error).message}`);
  }

  const summary = streamOf(container, "\u0005SummaryInformation");
  return { excel, vba, properties: summary ? readSummaryInformation(summary) : EMPTY_PROPERTIES, codeNames };
}

function streamOf(container: CFB$Container, name: string): Uint8Array | null {
  const entry = CFB.find(container, name);
  return entry?.content ? Uint8Array.from(entry.content as ArrayLike<number>) : null;
}

// [MS-OLEPS] の SummaryInformation から主要な項目だけを読む
const PID = { codePage: 1, title: 2, author: 4, lastAuthor: 8, createTime: 12, lastSaveTime: 13, appName: 18 };

export function readSummaryInformation(buf: Uint8Array): Properties {
  try {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const sectionOffset = view.getUint32(44, true);
    const count = view.getUint32(sectionOffset + 4, true);
    const props = new Map<number, number>();
    for (let i = 0; i < count; i++) {
      const at = sectionOffset + 8 + i * 8;
      props.set(view.getUint32(at, true), sectionOffset + view.getUint32(at + 4, true));
    }
    const codePageAt = props.get(PID.codePage);
    const codePage = codePageAt !== undefined ? view.getUint16(codePageAt + 4, true) : 1252;
    const value = (pid: number): string | null => {
      const at = props.get(pid);
      if (at === undefined) return null;
      const type = view.getUint16(at, true);
      if (type === 0x1e) {
        const len = view.getUint32(at + 4, true);
        const text = decodeText(buf.subarray(at + 8, at + 8 + len), codePage).replace(/\0+$/, "").trim();
        return text || null;
      }
      if (type === 0x40) {
        const low = view.getUint32(at + 4, true);
        const high = view.getUint32(at + 8, true);
        const ms = (high * 2 ** 32 + low) / 10_000 - 11_644_473_600_000;
        return ms > 0 ? new Date(ms).toISOString() : null;
      }
      return null;
    };
    return {
      ...EMPTY_PROPERTIES,
      title: value(PID.title),
      creator: value(PID.author),
      lastModifiedBy: value(PID.lastAuthor),
      created: value(PID.createTime),
      modified: value(PID.lastSaveTime),
      application: value(PID.appName),
    };
  } catch {
    return EMPTY_PROPERTIES;
  }
}
