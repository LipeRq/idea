// .xls(OLE複合ファイル)全体の読み取り: Workbook ストリーム、VBA(_VBA_PROJECT_CUR)、文書プロパティ。
import { rethrowIfFatal, UnsupportedFileError } from "../errors";
import type { CompoundFile } from "../ole/compoundFile";
import type { ExcelInfo, Properties } from "../schema";
import { decodeText } from "../vba/codepage";
import { cfbStorage, extractVbaProject, type RawVbaProject } from "../vba/project";
import type { Budget } from "../limits";
import { EMPTY_PROPERTIES } from "./common";
import { parseXlsWorkbook } from "./xls";

export interface XlsFile {
  excel: ExcelInfo;
  vba: RawVbaProject | null;
  properties: Properties;
  codeNames: Map<string, string>;
}

export function parseXls(container: CompoundFile, warnings: string[], budget?: Budget): XlsFile {
  const stream = container.read("Workbook") ?? container.read("Book");
  if (!stream) throw new UnsupportedFileError("Excelのブックとして読み込めませんでした(Workbook ストリームがありません)");
  const { excel, codeNames } = parseXlsWorkbook(stream, warnings, budget);
  warnings.push(".xls 形式では数式の件数のみを数え、式の内容とボタンへのマクロ登録は取り出していません");

  let vba: RawVbaProject | null = null;
  try {
    vba = extractVbaProject(cfbStorage(container, "_VBA_PROJECT_CUR"), warnings, budget);
  } catch (e) {
    rethrowIfFatal(e);
    warnings.push(`VBAプロジェクトを読めませんでした: ${(e as Error).message}`);
  }

  let summary: Uint8Array | null = null;
  try {
    summary = container.read("\u0005SummaryInformation");
  } catch (e) {
    rethrowIfFatal(e);
    warnings.push(`文書プロパティ(SummaryInformation)を読めませんでした: ${(e as Error).message}`);
  }
  return { excel, vba, properties: summary ? readSummaryInformation(summary) : EMPTY_PROPERTIES, codeNames };
}

// [MS-OLEPS] の SummaryInformation から主要な項目だけを読む
const PID = { codePage: 1, title: 2, author: 4, lastAuthor: 8, createTime: 12, lastSaveTime: 13, appName: 18 };

export function readSummaryInformation(buf: Uint8Array): Properties {
  try {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const sectionOffset = view.getUint32(44, true);
    const count = Math.min(view.getUint32(sectionOffset + 4, true), Math.floor(buf.length / 8));
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
