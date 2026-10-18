// .xlsm / .xlam / .xlsx / .xltm(SpreadsheetML の XML)の解析。
import type { Connection, ControlMacro, DefinedName, ExcelInfo, ExternalLink, Sheet } from "../schema";
import type { Budget } from "../limits";
import { hasCredentials, maskSecrets } from "../secrets";
import { attr, collectControlMacros, readExternalLink } from "./common";
import { decodeXmlText, nodeText, type OpcPackage, type XmlNode } from "./opc";
import { firstElement, scanElements } from "./xmlScan";

export interface WorkbookParts {
  excel: ExcelInfo;
  vbaProjectPath: string | null;
  /** ThisWorkbook / Sheet1 などのコード名(小文字)→ 表示名 */
  codeNames: Map<string, string>;
  /** 認証情報を含むデータ接続 */
  credentialLocations: string[];
}

const MAX_FORMULA_SAMPLES = 5;

const SHEET_KIND: Record<string, Sheet["kind"]> = {
  worksheet: "worksheet",
  chartsheet: "chartsheet",
  dialogsheet: "dialogsheet",
  xlMacrosheet: "macrosheet",
  xlIntlMacrosheet: "macrosheet",
};

const CONNECTION_TYPE: Record<string, string> = {
  "1": "ODBC",
  "2": "DAO",
  "3": "ファイル",
  "4": "Web",
  "5": "OLE DB",
  "6": "テキスト",
  "7": "ADO",
  "8": "DSP",
};

export function parseSpreadsheetMl(pkg: OpcPackage, workbookPath: string, warnings: string[] = []): WorkbookParts {
  const budget = pkg.budget;
  const wbXml = pkg.xml(workbookPath)?.workbook ?? {};
  const rels = pkg.rels(workbookPath);
  const relById = new Map(rels.map((r) => [r.id, r]));
  const codeNames = new Map<string, string>();
  const wbCodeName = wbXml.workbookPr?.codeName;
  if (wbCodeName) codeNames.set(String(wbCodeName).toLowerCase(), "ブック");

  const sheets: Sheet[] = [];
  const controlMacros: ControlMacro[] = [];
  const sheetNodes: XmlNode[] = budget.cap(asArray(wbXml.sheets?.sheet), budget.limits.maxSheets, warnings, "シート");
  sheetNodes.forEach((node, index) => {
    budget.checkNow();
    const name = String(node.name ?? `Sheet${index + 1}`);
    const rel = relById.get(String(node.id ?? ""));
    const xml = rel && !rel.external ? pkg.text(rel.target) : null;
    const scan = xml ? scanSheetXml(xml, budget) : null;
    const state = String(node.state ?? "visible");
    sheets.push({
      name,
      codeName: scan?.codeName ?? null,
      index,
      kind: SHEET_KIND[rel?.type ?? ""] ?? "worksheet",
      state: state === "hidden" ? "hidden" : state === "veryHidden" ? "veryHidden" : "visible",
      usedRange: scan?.dimension ?? null,
      formulaCount: scan?.formulaCount ?? 0,
      formulaSamples: scan?.samples ?? [],
      externalRefCount: scan?.externalRefCount ?? 0,
      brokenRefCount: scan?.brokenRefCount ?? 0,
    });
    if (scan?.codeName) codeNames.set(scan.codeName.toLowerCase(), `シート「${name}」`);
    if (rel && !rel.external) controlMacros.push(...collectControlMacros(pkg, rel.target, name, xml));
  });

  const nameNodes = budget.cap(asArray(wbXml.definedNames?.definedName), budget.limits.maxListItems, warnings, "名前定義");
  const definedNames: DefinedName[] = nameNodes.map((n: XmlNode) => {
    const name = String(n.name ?? "");
    const local = n.localSheetId !== undefined ? Number(n.localSheetId) : null;
    return {
      name,
      scope: local !== null ? (sheets[local]?.name ?? String(local)) : null,
      refersTo: nodeText(n),
      hidden: String(n.hidden ?? "") === "1" || String(n.hidden ?? "") === "true",
      builtIn: name.startsWith("_xlnm."),
    };
  });

  const externalLinks: ExternalLink[] = [];
  budget.cap(asArray(wbXml.externalReferences?.externalReference), budget.limits.maxListItems, warnings, "外部リンク").forEach((ref: XmlNode, i: number) => {
    const rel = relById.get(String(ref.id ?? ""));
    if (rel && !rel.external) externalLinks.push(readExternalLink(pkg, rel.target, i + 1));
  });

  const connectionsRel = rels.find((r) => r.type === "connections");
  const credentialLocations: string[] = [];
  const connections = connectionsRel ? parseConnections(pkg.xml(connectionsRel.target), credentialLocations, warnings, budget) : [];
  const vbaRel = rels.find((r) => r.type === "vbaProject");

  return {
    excel: {
      sheets,
      definedNames,
      externalLinks,
      connections,
      controlMacros,
      formulaCount: sheets.reduce((s, x) => s + x.formulaCount, 0),
      formulaTextAvailable: true,
    },
    vbaProjectPath: vbaRel && !vbaRel.external ? vbaRel.target : null,
    codeNames,
    credentialLocations,
  };
}

interface SheetScan {
  codeName: string | null;
  dimension: string | null;
  formulaCount: number;
  samples: Sheet["formulaSamples"];
  externalRefCount: number;
  brokenRefCount: number;
}

/** シートXMLは大きくなりうるので、DOMにせず線形時間のスキャナで走査する。セルの値は読まない。 */
export function scanSheetXml(xml: string, budget?: Budget): SheetScan {
  // sheetPr / dimension は sheetData より前にある
  const dataAt = xml.search(/<(?:[\w.-]+:)?sheetData[\s/>]/);
  const head = xml.slice(0, dataAt >= 0 ? dataAt : Math.min(xml.length, 1 << 20));
  const sheetPr = firstElement(head, "sheetPr");
  const dimensionTag = firstElement(head, "dimension");
  const codeName = sheetPr ? attr(sheetPr.attrs, "codeName") : null;
  const dimension = dimensionTag ? attr(dimensionTag.attrs, "ref") : null;
  let formulaCount = 0;
  let externalRefCount = 0;
  let brokenRefCount = 0;
  const samples: Sheet["formulaSamples"] = [];
  const seen = new Set<string>();
  for (const el of scanElements(xml, "f", { prefix: "(?:x:)?", withInner: true })) {
    formulaCount++;
    budget?.check();
    const text = el.inner ? decodeXmlText(el.inner) : "";
    if (!text) continue; // 共有数式の子セルは式テキストを持たない
    if (/\[\d+\]/.test(text)) externalRefCount++;
    if (text.includes("#REF!")) brokenRefCount++;
    if (samples.length < MAX_FORMULA_SAMPLES && !seen.has(text)) {
      seen.add(text);
      samples.push({ cell: cellRefBefore(xml, el.index), formula: text });
    }
  }
  return {
    codeName,
    dimension,
    formulaCount,
    samples,
    externalRefCount,
    brokenRefCount,
  };
}

function cellRefBefore(xml: string, index: number): string | null {
  const start = Math.max(xml.lastIndexOf("<c ", index), xml.lastIndexOf("<x:c ", index));
  if (start < 0) return null;
  const end = xml.indexOf(">", start);
  if (end < 0) return null;
  return attr(xml.slice(start + 2, end), "r");
}

function parseConnections(doc: XmlNode, credentialLocations: string[], warnings: string[], budget: Budget): Connection[] {
  const list: XmlNode[] = budget.cap(asArray(doc?.connections?.connection), budget.limits.maxListItems, warnings, "データ接続");
  return list.map((c) => {
    const db = c.dbPr ?? c.olapPr ?? null;
    const raw = db?.connection ? String(db.connection) : null;
    const web = c.webPr?.url ? String(c.webPr.url) : null;
    const text = c.textPr?.sourceFile ? String(c.textPr.sourceFile) : null;
    let type = CONNECTION_TYPE[String(c.type ?? "")] ?? "不明";
    if (raw && /Microsoft\.Mashup/i.test(raw)) type = "Power Query";
    if (raw && hasCredentials(raw)) credentialLocations.push(`データ接続「${c.name ?? c.id}」`);
    return {
      name: String(c.name ?? c.id ?? ""),
      type,
      connectionString: raw ? maskSecrets(raw) : (web ?? text),
      command: db?.command ? maskSecrets(String(db.command)) : null,
      description: c.description ? String(c.description) : null,
    };
  });
}

/** XML の要素が1つでも配列でも、配列にそろえる(壊れたファイルで文字列などが来ても落ちないように) */
function asArray(v: unknown): XmlNode[] {
  if (v === undefined || v === null) return [];
  return (Array.isArray(v) ? v : [v]).filter((x) => x !== null && typeof x === "object");
}
