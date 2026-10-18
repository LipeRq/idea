// 解析の入口。ファイル形式を判定し、形式ごとの抽出結果を InventoryReport にまとめる。
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import CFB from "cfb";
import { parseAccess } from "./access/access";
import { readProperties } from "./excel/common";
import { OpcPackage } from "./excel/opc";
import { parseSpreadsheetMl, type WorkbookParts } from "./excel/ooxml";
import { parseXls } from "./excel/xlsFile";
import { parseXlsbWorkbook } from "./excel/xlsb";
import { UnsupportedFileError } from "./errors";
import { detectFindings } from "./findings";
import {
  InventoryReportSchema,
  SCHEMA_VERSION,
  type Dependency,
  type EntryPoint,
  type ExcelInfo,
  type FileFormat,
  type InventoryReport,
  type Properties,
} from "./schema";
import { analyzeVbaProject } from "./vba/analyze";
import { cfbStorage, extractVbaProject, type RawVbaProject } from "./vba/project";

export const TOOL_NAME = "ai-inventory";
export const TOOL_VERSION = "0.1.0";

export interface AnalyzeOptions {
  /** ソースコードをレポートに含めるか(既定: 含める) */
  includeSource?: boolean;
  /** Access のデータベースパスワード */
  password?: string;
  /** レポートの生成日時(テスト用) */
  now?: Date;
}


export async function analyzeFile(path: string, options: AnalyzeOptions = {}): Promise<InventoryReport> {
  const data = await readFile(path);
  return analyzeBuffer(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), basename(path), options);
}

interface Extracted {
  format: FileFormat;
  kind: "excel" | "access";
  properties: Properties;
  excel: ExcelInfo | null;
  access: InventoryReport["access"];
  vba: RawVbaProject | null;
  codeNames: Map<string, string>;
  dependencies: Dependency[];
  entryPoints: EntryPoint[];
  credentialLocations: string[];
}

export function analyzeBuffer(data: Uint8Array, fileName: string, options: AnalyzeOptions = {}): InventoryReport {
  const warnings: string[] = [];
  const extracted = extract(data, fileName, options, warnings);
  const host = extracted.kind;

  const vba = extracted.vba
    ? analyzeVbaProject(extracted.vba, {
        host,
        includeSource: options.includeSource ?? true,
        sheetNames: new Map(
          [...extracted.codeNames].flatMap(([k, v]) => {
            const m = /^シート「(.*)」$/.exec(v);
            return m ? [[k, m[1]] as const] : [];
          }),
        ),
      })
    : null;

  const entryPoints = [...extracted.entryPoints, ...(vba?.entryPoints ?? [])];
  const procIndex = new Map<string, string>();
  for (const m of vba?.project.modules ?? []) {
    for (const p of m.procedures) {
      procIndex.set(`${m.name}.${p.name}`.toLowerCase(), p.id);
      if (m.type === "standard" && p.scope !== "private" && !procIndex.has(p.name.toLowerCase())) {
        procIndex.set(p.name.toLowerCase(), p.id);
      }
    }
  }
  for (const c of extracted.excel?.controlMacros ?? []) {
    entryPoints.push({
      kind: "button",
      trigger: `シート「${c.sheet}」の${c.text ? `「${c.text}」` : c.control}をクリックしたとき`,
      procedure: procIndex.get(c.macro.toLowerCase()) ?? null,
      target: c.macro,
      location: { part: `シート「${c.sheet}」` },
    });
  }
  for (const n of extracted.excel?.definedNames ?? []) {
    if (/^(_xlnm\.)?Auto_(Open|Close)$/i.test(n.name) && n.refersTo !== null) {
      entryPoints.push({ kind: "autoMacro", trigger: `ブックを開閉したとき(名前定義 ${n.name})`, procedure: null, target: n.refersTo, location: { part: "名前定義" } });
    }
  }

  // 呼び出し元がなく、どの起動経路にも載っていない標準モジュールの引数なし Public プロシージャは手動実行の候補
  // (Access ではフォームのイベントプロパティやマクロの RunCode から Function が呼ばれることも多い)
  const reached = new Set(entryPoints.map((e) => e.procedure));
  const manualKinds = host === "access" ? ["sub", "function"] : ["sub"];
  const manualTrigger =
    host === "access" ? "マクロ(RunCode)やフォームのイベントプロパティなどから実行" : "マクロ一覧(Alt+F8)などから手動で実行";
  for (const m of vba?.project.modules ?? []) {
    if (m.type !== "standard") continue;
    for (const p of m.procedures) {
      if (!manualKinds.includes(p.kind) || p.scope === "private" || p.params.length > 0 || p.isEvent) continue;
      if (p.calledBy.length > 0 || reached.has(p.id)) continue;
      entryPoints.push({
        kind: "macro",
        trigger: manualTrigger,
        procedure: p.id,
        target: p.name,
        location: { module: m.name, procedure: p.name, line: p.startLine },
      });
    }
  }

  const dependencies = [...extracted.dependencies, ...(vba?.dependencies ?? [])];
  const callGraph = vba?.callGraph ?? [];
  const partial = {
    excel: extracted.excel,
    access: extracted.access,
    vba: vba?.project ?? null,
    dependencies,
    callGraph,
    entryPoints,
  };
  const findings = detectFindings(partial, { credentialLocations: extracted.credentialLocations });

  if (extracted.access && extracted.access.forms.length + extracted.access.reports.length > 0) {
    warnings.push("Accessのフォーム・レポートは名前の一覧のみです(画面レイアウトやコントロールの設定は解析していません)");
  }
  if (extracted.access && extracted.access.macros.length > 0) {
    warnings.push("Accessのマクロ(マクロオブジェクト)は名前の一覧のみで、中身は解析していません");
  }

  const modules = vba?.project.modules ?? [];
  const report: InventoryReport = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: (options.now ?? new Date()).toISOString(),
    tool: { name: TOOL_NAME, version: TOOL_VERSION },
    file: {
      name: fileName,
      format: extracted.format,
      kind: extracted.kind,
      sizeBytes: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
    },
    properties: extracted.properties,
    ...partial,
    findings,
    stats: {
      sheetCount: extracted.excel?.sheets.length ?? 0,
      formulaCount: extracted.excel?.formulaCount ?? 0,
      moduleCount: modules.length,
      procedureCount: modules.reduce((s, m) => s + m.procedures.length, 0),
      codeLineCount: modules.reduce((s, m) => s + m.codeLineCount, 0),
      totalLineCount: modules.reduce((s, m) => s + m.lineCount, 0),
      dependencyCount: dependencies.filter((d) => !(d.kind === "reference" && d.category === "標準")).length,
      tableCount: extracted.access?.tables.length ?? 0,
      queryCount: extracted.access?.queries.filter((q) => !q.hidden).length ?? 0,
    },
    warnings,
  };
  return InventoryReportSchema.parse(report);
}

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function extract(data: Uint8Array, fileName: string, options: AnalyzeOptions, warnings: string[]): Extracted {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  const isZip = data[0] === 0x50 && data[1] === 0x4b;
  const isOle = OLE_MAGIC.every((b, i) => data[i] === b);
  const jet = new TextDecoder("latin1").decode(data.subarray(4, 19));

  if (jet === "Standard Jet DB" || jet === "Standard ACE DB") {
    const a = parseAccess(data, options.password, warnings);
    return {
      format: jet === "Standard ACE DB" || ext === "accdb" ? "accdb" : "mdb",
      kind: "access",
      properties: a.properties,
      excel: null,
      access: a.access,
      vba: a.vba,
      codeNames: new Map(),
      dependencies: a.dependencies,
      entryPoints: a.entryPoints,
      credentialLocations: a.credentialLocations,
    };
  }

  if (isZip) {
    const pkg = new OpcPackage(data);
    const officeDoc = pkg.rels("").find((r) => r.type === "officeDocument");
    const workbookPath = officeDoc?.target ?? (pkg.bytes("xl/workbook.xml") ? "xl/workbook.xml" : "xl/workbook.bin");
    if (!/workbook\.(xml|bin)$/i.test(workbookPath) || !pkg.bytes(workbookPath)) {
      throw new UnsupportedFileError("Excelのブックとして読み込めませんでした(Word・PowerPoint などのファイルは対象外です)");
    }
    const binary = workbookPath.toLowerCase().endsWith(".bin");
    const parts: WorkbookParts = binary ? parseXlsbWorkbook(pkg, workbookPath, warnings) : parseSpreadsheetMl(pkg, workbookPath);
    const vbaBin = parts.vbaProjectPath ? pkg.bytes(parts.vbaProjectPath) : null;
    const vba = vbaBin ? readVbaFromOle(vbaBin, "", warnings) : null;
    if (parts.excel.formulaTextAvailable === false) {
      warnings.push("xlsb 形式では数式の件数のみを数え、式の内容は取り出していません");
    }
    return {
      format: binary ? "xlsb" : ooxmlFormat(ext, vbaBin !== null),
      kind: "excel",
      properties: readProperties(pkg),
      excel: parts.excel,
      access: null,
      vba,
      codeNames: parts.codeNames,
      dependencies: workbookDependencies(parts.excel),
      entryPoints: [],
      credentialLocations: parts.credentialLocations,
    };
  }

  if (isOle) {
    const container = CFB.read(data, { type: "buffer" });
    if (CFB.find(container, "EncryptionInfo")) {
      throw new UnsupportedFileError("パスワードで暗号化されたブックは解析できません。パスワードを外してから読み込んでください");
    }
    const xls = parseXls(container, warnings);
    return {
      format: "xls",
      kind: "excel",
      properties: xls.properties,
      excel: xls.excel,
      access: null,
      vba: xls.vba,
      codeNames: xls.codeNames,
      dependencies: workbookDependencies(xls.excel),
      entryPoints: [],
      credentialLocations: [],
    };
  }

  throw new UnsupportedFileError(
    `対応していないファイル形式です(${fileName})。対応形式: .xlsm / .xlam / .xlsx / .xlsb / .xls / .accdb / .mdb`,
  );
}

function ooxmlFormat(ext: string, hasVba: boolean): FileFormat {
  if (ext === "xlam" || ext === "xltm" || ext === "xlsx") return ext;
  if (ext === "xlsm") return "xlsm";
  return hasVba ? "xlsm" : "xlsx";
}

export function readVbaFromOle(bin: Uint8Array, root: string, warnings: string[]): RawVbaProject | null {
  try {
    const container = CFB.read(bin, { type: "buffer" });
    return extractVbaProject(cfbStorage(container, root), warnings);
  } catch (e) {
    warnings.push(`VBAプロジェクトを読めませんでした: ${(e as Error).message}`);
    return null;
  }
}

function workbookDependencies(excel: ExcelInfo | null): Dependency[] {
  if (!excel) return [];
  const deps: Dependency[] = [];
  for (const l of excel.externalLinks) {
    deps.push({ kind: "externalLink", target: l.target, category: l.type, location: { part: "外部リンク" } });
  }
  for (const c of excel.connections) {
    deps.push({
      kind: "dataConnection",
      target: c.connectionString ?? c.command ?? c.name,
      category: c.type,
      location: { part: `データ接続「${c.name}」` },
    });
  }
  return deps;
}
