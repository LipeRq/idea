// デモ用サンプルの .xlsm(SpreadsheetML の zip)を組み立てる。
// VBA プロジェクト(vbaProject.bin)はテスト用ヘルパー(test/helpers/ovba.ts)で作り、
// シート・名前定義・外部リンク・データ接続・ボタン/図形のマクロ登録はこのファイルで定義どおりに組み立てる。
// 生成結果が毎回同じバイト列になるように、zip の更新日時は固定する。
import { strToU8, zipSync } from "fflate";
import { buildVbaProjectBin, type TestProject } from "../../test/helpers/ovba";

const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const NS_XDR = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const NS_X14 = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main";

/** zip 内のファイルの更新日時(生成結果を再現可能にするため固定) */
const FIXED_MTIME = new Date("2024-04-01T09:00:00Z");

export interface CellSpec {
  /** A1 形式のセル番地 */
  ref: string;
  /** 文字列・数値(数式セルでは省略) */
  value?: string | number;
  /** 先頭の = を付けない数式 */
  formula?: string;
  /** 共有数式の範囲(この範囲の先頭セルにだけ式を書き、残りは共有数式の参照にする) */
  sharedRange?: string;
}

export interface ButtonSpec {
  /** form: フォームコントロールのボタン / shape: 図形(角丸四角形など)にマクロを登録したもの */
  kind: "form" | "shape";
  /** ボタンに表示する文字 */
  text: string;
  /** 登録するマクロ名(Excel の「マクロの登録」で選んだ名前) */
  macro: string;
  /** 左上のセル位置(0 始まりの列・行)と、占めるセルの数 */
  col: number;
  row: number;
  cols?: number;
  rows?: number;
}

export interface SheetSpec {
  name: string;
  /** VBA のコード名(Sheet1 など)。同じ名前のドキュメントモジュールと対応する */
  codeName: string;
  state?: "visible" | "hidden" | "veryHidden";
  cells: CellSpec[];
  buttons?: ButtonSpec[];
  /** 列幅(1 始まりの列番号 → 幅) */
  columnWidths?: Record<number, number>;
}

export interface DefinedNameSpec {
  name: string;
  refersTo: string;
  /** シート単位の名前のとき、そのシートの番号(0 始まり) */
  localSheetId?: number;
  hidden?: boolean;
}

export interface ExternalLinkSpec {
  /** 参照先ブックのパス(\\server\share\… や C:\…) */
  path: string;
  sheetNames: string[];
}

export interface ConnectionSpec {
  name: string;
  /** 1: ODBC / 5: OLE DB など(SpreadsheetML の connection@type) */
  type: number;
  connection: string;
  command?: string;
  description?: string;
}

export interface PropertiesSpec {
  title: string;
  creator: string;
  lastModifiedBy: string;
  created: string;
  modified: string;
  company: string;
}

export interface WorkbookSpec {
  properties: PropertiesSpec;
  sheets: SheetSpec[];
  definedNames?: DefinedNameSpec[];
  externalLinks?: ExternalLinkSpec[];
  connections?: ConnectionSpec[];
  vba: TestProject;
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function rels(list: { id: string; type: string; target: string; external?: boolean }[]): string {
  const items = list
    .map(
      (r) =>
        `<Relationship Id="${r.id}" Type="${r.type.startsWith("http") ? r.type : `${NS_REL}/${r.type}`}" Target="${esc(r.target)}"${r.external ? ' TargetMode="External"' : ""}/>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${NS_PKG_REL}">${items}</Relationships>`;
}

/** "AB12" → { col: 27, row: 12 }(列は 0 始まり、行は 1 始まり) */
function parseRef(ref: string): { col: number; row: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) throw new Error(`セル番地が不正です: ${ref}`);
  const col = [...m[1]].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;
  return { col, row: Number(m[2]) };
}

function colName(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** 共有数式の範囲を、先頭セル以外のセル番地に展開する(縦 1 列・横 1 行のどちらか) */
function expandShared(range: string): string[] {
  const [a, b] = range.split(":").map(parseRef);
  const refs: string[] = [];
  for (let r = a.row; r <= b.row; r++) {
    for (let c = a.col; c <= b.col; c++) refs.push(`${colName(c)}${r}`);
  }
  return refs.slice(1);
}

function sheetXml(sheet: SheetSpec, rIds: { drawing?: string; vml?: string; ctrlProps: string[] }, shapeIdBase: number): string {
  type Cell = { col: number; xml: string };
  const rows = new Map<number, Cell[]>();
  const put = (ref: string, xml: string) => {
    const { col, row } = parseRef(ref);
    const list = rows.get(row) ?? [];
    list.push({ col, xml });
    rows.set(row, list);
  };
  let si = 0;
  let maxCol = 0;
  let maxRow = 1;
  for (const c of sheet.cells) {
    const { col, row } = parseRef(c.ref);
    maxCol = Math.max(maxCol, col);
    maxRow = Math.max(maxRow, row);
    if (c.formula !== undefined) {
      if (c.sharedRange) {
        const id = si++;
        put(c.ref, `<c r="${c.ref}"><f t="shared" ref="${c.sharedRange}" si="${id}">${esc(c.formula)}</f></c>`);
        for (const ref of expandShared(c.sharedRange)) {
          const p = parseRef(ref);
          maxCol = Math.max(maxCol, p.col);
          maxRow = Math.max(maxRow, p.row);
          put(ref, `<c r="${ref}"><f t="shared" si="${id}"/></c>`);
        }
      } else {
        put(c.ref, `<c r="${c.ref}"><f>${esc(c.formula)}</f></c>`);
      }
    } else if (typeof c.value === "number") {
      put(c.ref, `<c r="${c.ref}"><v>${c.value}</v></c>`);
    } else if (c.value !== undefined) {
      put(c.ref, `<c r="${c.ref}" t="inlineStr"><is><t>${esc(c.value)}</t></is></c>`);
    }
  }
  const sheetData = [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([r, cells]) => `<row r="${r}">${cells.sort((a, b) => a.col - b.col).map((c) => c.xml).join("")}</row>`)
    .join("");
  const cols = sheet.columnWidths
    ? `<cols>${Object.entries(sheet.columnWidths)
        .map(([c, w]) => `<col min="${c}" max="${c}" width="${w}" customWidth="1"/>`)
        .join("")}</cols>`
    : "";
  const formButtons = (sheet.buttons ?? []).filter((b) => b.kind === "form");
  const controls =
    formButtons.length > 0
      ? `<mc:AlternateContent><mc:Choice Requires="x14"><controls>${formButtons
          .map((b, i) => {
            const anchor = anchorXml(b, "xdr");
            return `<mc:AlternateContent><mc:Choice Requires="x14"><control shapeId="${shapeIdBase + i}" r:id="${rIds.ctrlProps[i]}" name="Button ${i + 1}"><controlPr defaultSize="0" print="0" autoFill="0" autoPict="0" macro="[0]!${esc(b.macro)}"><anchor moveWithCells="1" sizeWithCells="1">${anchor}</anchor></controlPr></control></mc:Choice></mc:AlternateContent>`;
          })
          .join("")}</controls></mc:Choice></mc:AlternateContent>`
      : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}" xmlns:mc="${NS_MC}" xmlns:x14="${NS_X14}" xmlns:xdr="${NS_XDR}" mc:Ignorable="x14">` +
    `<sheetPr codeName="${esc(sheet.codeName)}"/>` +
    `<dimension ref="A1:${colName(maxCol)}${maxRow}"/>` +
    `<sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="18.75"/>` +
    cols +
    `<sheetData>${sheetData}</sheetData>` +
    `<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>` +
    (rIds.drawing ? `<drawing r:id="${rIds.drawing}"/>` : "") +
    (rIds.vml ? `<legacyDrawing r:id="${rIds.vml}"/>` : "") +
    controls +
    `</worksheet>`;
}

function anchorXml(b: ButtonSpec, prefix: string): string {
  const p = (tag: string, v: number) => `<${prefix}:${tag}>${v}</${prefix}:${tag}>`;
  const from = `<${prefix}:from>${p("col", b.col)}${p("colOff", 0)}${p("row", b.row)}${p("rowOff", 0)}</${prefix}:from>`;
  const to = `<${prefix}:to>${p("col", b.col + (b.cols ?? 2))}${p("colOff", 0)}${p("row", b.row + (b.rows ?? 2))}${p("rowOff", 0)}</${prefix}:to>`;
  return from + to;
}

function drawingXml(buttons: ButtonSpec[]): string {
  const anchors = buttons
    .map((b, i) => {
      const id = i + 2;
      return (
        `<xdr:twoCellAnchor>${anchorXml(b, "xdr")}` +
        `<xdr:sp macro="[0]!${esc(b.macro)}" textlink=""><xdr:nvSpPr><xdr:cNvPr id="${id}" name="角丸四角形 ${id - 1}"/><xdr:cNvSpPr/></xdr:nvSpPr>` +
        `<xdr:spPr><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="4472C4"/></a:solidFill></xdr:spPr>` +
        `<xdr:txBody><a:bodyPr vertOverflow="clip" rtlCol="0" anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="ja-JP" altLang="en-US" sz="1400"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>${esc(b.text)}</a:t></a:r></a:p></xdr:txBody></xdr:sp>` +
        `<xdr:clientData/></xdr:twoCellAnchor>`
      );
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="${NS_XDR}" xmlns:a="${NS_A}">${anchors}</xdr:wsDr>`;
}

function vmlXml(buttons: ButtonSpec[], idmap: number, shapeIdBase: number): string {
  const shapes = buttons
    .map(
      (b, i) =>
        `<v:shape id="_x0000_s${shapeIdBase + i}" type="#_x0000_t201" style="position:absolute;z-index:${i + 1}" o:button="t" fillcolor="buttonFace [67]" strokecolor="windowText [64]" o:insetmode="auto">` +
        `<v:fill color2="buttonFace [67]" o:detectmouseclick="t"/><o:lock v:ext="edit" rotation="t"/>` +
        `<v:textbox style="mso-direction-alt:auto" o:singleclick="f"><div style="text-align:center"><font face="游ゴシック" size="220" color="#000000">${esc(b.text)}</font></div></v:textbox>` +
        `<x:ClientData ObjectType="Button"><x:Anchor>${b.col}, 0, ${b.row}, 0, ${b.col + (b.cols ?? 2)}, 0, ${b.row + (b.rows ?? 2)}, 0</x:Anchor><x:PrintObject>False</x:PrintObject><x:AutoFill>False</x:AutoFill>` +
        `<x:FmlaMacro>[0]!${esc(b.macro)}</x:FmlaMacro><x:TextHAlign>Center</x:TextHAlign><x:TextVAlign>Center</x:TextVAlign></x:ClientData></v:shape>`,
    )
    .join("");
  return (
    `<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">` +
    `<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="${idmap}"/></o:shapelayout>` +
    `<v:shapetype id="_x0000_t201" coordsize="21600,21600" o:spt="201" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path shadowok="f" o:extrusionok="f" strokeok="f" fillok="f" o:connecttype="rect"/><o:lock v:ext="edit" shapetype="t"/></v:shapetype>` +
    shapes +
    `</xml>`
  );
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${NS_MAIN}"><fonts count="1"><font><sz val="11"/><name val="游ゴシック"/><family val="3"/><charset val="128"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="標準" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/** 外部リンクの参照先(rels の Target)。Excel と同じく file:/// を付け、ASCII 以外は % で符号化する */
function externalTarget(path: string): string {
  return "file:///" + path.replace(/[^\x00-\x7f]+/g, (s) => encodeURIComponent(s));
}

export function buildWorkbook(spec: WorkbookSpec): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const overrides: [string, string][] = [];
  const put = (path: string, text: string, contentType?: string) => {
    files[path] = strToU8(text);
    if (contentType) overrides.push([`/${path}`, contentType]);
  };

  const p = spec.properties;
  put(
    "docProps/core.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(p.title)}</dc:title><dc:creator>${esc(p.creator)}</dc:creator><cp:lastModifiedBy>${esc(p.lastModifiedBy)}</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${p.created}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${p.modified}</dcterms:modified></cp:coreProperties>`,
    "application/vnd.openxmlformats-package.core-properties+xml",
  );
  put(
    "docProps/app.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Excel</Application><DocSecurity>0</DocSecurity><Company>${esc(p.company)}</Company><AppVersion>16.0300</AppVersion></Properties>`,
    "application/vnd.openxmlformats-officedocument.extended-properties+xml",
  );
  put(
    "_rels/.rels",
    rels([
      { id: "rId1", type: "officeDocument", target: "xl/workbook.xml" },
      { id: "rId2", type: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", target: "docProps/core.xml" },
      { id: "rId3", type: "extended-properties", target: "docProps/app.xml" },
    ]),
  );

  const wbRels: { id: string; type: string; target: string }[] = [];
  const nextWbRel = () => `rId${wbRels.length + 1}`;
  const sheetRelIds: string[] = [];
  let ctrlPropCount = 0;
  let drawingCount = 0;
  let vmlCount = 0;

  spec.sheets.forEach((sheet, index) => {
    const n = index + 1;
    const id = nextWbRel();
    sheetRelIds.push(id);
    wbRels.push({ id, type: "worksheet", target: `worksheets/sheet${n}.xml` });
    const buttons = sheet.buttons ?? [];
    const shapes = buttons.filter((b) => b.kind === "shape");
    const forms = buttons.filter((b) => b.kind === "form");
    const sheetRels: { id: string; type: string; target: string }[] = [];
    const rIds: { drawing?: string; vml?: string; ctrlProps: string[] } = { ctrlProps: [] };
    const idmap = n;
    const shapeIdBase = idmap * 1024 + 1;
    if (shapes.length > 0) {
      const d = ++drawingCount;
      rIds.drawing = `rId${sheetRels.length + 1}`;
      sheetRels.push({ id: rIds.drawing, type: "drawing", target: `../drawings/drawing${d}.xml` });
      put(`xl/drawings/drawing${d}.xml`, drawingXml(shapes), "application/vnd.openxmlformats-officedocument.drawing+xml");
    }
    if (forms.length > 0) {
      const v = ++vmlCount;
      rIds.vml = `rId${sheetRels.length + 1}`;
      sheetRels.push({ id: rIds.vml, type: "vmlDrawing", target: `../drawings/vmlDrawing${v}.vml` });
      put(`xl/drawings/vmlDrawing${v}.vml`, vmlXml(forms, idmap, shapeIdBase));
      for (let i = 0; i < forms.length; i++) {
        const c = ++ctrlPropCount;
        const rid = `rId${sheetRels.length + 1}`;
        rIds.ctrlProps.push(rid);
        sheetRels.push({ id: rid, type: "ctrlProp", target: `../ctrlProps/ctrlProp${c}.xml` });
        put(
          `xl/ctrlProps/ctrlProp${c}.xml`,
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<formControlPr xmlns="${NS_X14}" objectType="Button" lockText="1"/>`,
          "application/vnd.ms-excel.controlproperties+xml",
        );
      }
    }
    put(`xl/worksheets/sheet${n}.xml`, sheetXml(sheet, rIds, shapeIdBase), "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml");
    if (sheetRels.length > 0) put(`xl/worksheets/_rels/sheet${n}.xml.rels`, rels(sheetRels));
  });

  const stylesId = nextWbRel();
  wbRels.push({ id: stylesId, type: "styles", target: "styles.xml" });
  put("xl/styles.xml", STYLES, "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml");

  const vbaId = nextWbRel();
  wbRels.push({ id: vbaId, type: "http://schemas.microsoft.com/office/2006/relationships/vbaProject", target: "vbaProject.bin" });
  files["xl/vbaProject.bin"] = buildVbaProjectBin(spec.vba);

  const externalRefIds: string[] = [];
  (spec.externalLinks ?? []).forEach((link, i) => {
    const n = i + 1;
    const id = nextWbRel();
    externalRefIds.push(id);
    wbRels.push({ id, type: "externalLink", target: `externalLinks/externalLink${n}.xml` });
    put(
      `xl/externalLinks/externalLink${n}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<externalLink xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><externalBook r:id="rId1"><sheetNames>${link.sheetNames
        .map((s) => `<sheetName val="${esc(s)}"/>`)
        .join("")}</sheetNames></externalBook></externalLink>`,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml",
    );
    put(
      `xl/externalLinks/_rels/externalLink${n}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${NS_REL}/externalLinkPath" Target="${esc(externalTarget(link.path))}" TargetMode="External"/></Relationships>`,
    );
  });

  if (spec.connections && spec.connections.length > 0) {
    wbRels.push({ id: nextWbRel(), type: "connections", target: "connections.xml" });
    put(
      "xl/connections.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<connections xmlns="${NS_MAIN}">${spec.connections
        .map(
          (c, i) =>
            `<connection id="${i + 1}" name="${esc(c.name)}"${c.description ? ` description="${esc(c.description)}"` : ""} type="${c.type}" refreshedVersion="6" background="1" saveData="1"><dbPr connection="${esc(c.connection)}"${c.command ? ` command="${esc(c.command)}"` : ""}/></connection>`,
        )
        .join("")}</connections>`,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml",
    );
  }

  const sheetsXml = spec.sheets
    .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}"${s.state && s.state !== "visible" ? ` state="${s.state}"` : ""} r:id="${sheetRelIds[i]}"/>`)
    .join("");
  const externalXml = externalRefIds.length > 0 ? `<externalReferences>${externalRefIds.map((id) => `<externalReference r:id="${id}"/>`).join("")}</externalReferences>` : "";
  const namesXml =
    spec.definedNames && spec.definedNames.length > 0
      ? `<definedNames>${spec.definedNames
          .map(
            (n) =>
              `<definedName name="${esc(n.name)}"${n.localSheetId !== undefined ? ` localSheetId="${n.localSheetId}"` : ""}${n.hidden ? ' hidden="1"' : ""}>${esc(n.refersTo)}</definedName>`,
          )
          .join("")}</definedNames>`
      : "";
  put(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><workbookPr codeName="ThisWorkbook" defaultThemeVersion="164011"/><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="12300"/></bookViews><sheets>${sheetsXml}</sheets>${externalXml}${namesXml}<calcPr calcId="191029"/></workbook>`,
    "application/vnd.ms-excel.sheet.macroEnabled.main+xml",
  );
  put("xl/_rels/workbook.xml.rels", rels(wbRels));

  files["[Content_Types].xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>` +
      overrides.map(([part, type]) => `<Override PartName="${esc(part)}" ContentType="${type}"/>`).join("") +
      `</Types>`,
  );

  // [Content_Types].xml を先頭に置く(Excel が作るファイルと同じ順序)
  const ordered: Record<string, Uint8Array> = { "[Content_Types].xml": files["[Content_Types].xml"] };
  for (const [k, v] of Object.entries(files)) if (k !== "[Content_Types].xml") ordered[k] = v;
  return zipSync(ordered, { mtime: FIXED_MTIME });
}

// ---- シートの中身を書くための小さなヘルパー ----

/** 1 行に見出しなどの文字列を左から並べる(start は "A4" のような先頭セル) */
export function rowLabels(start: string, texts: (string | number)[]): CellSpec[] {
  const { col, row } = parseRef(start);
  return texts.map((value, i) => ({ ref: `${colName(col + i)}${row}`, value }));
}

/** 縦 1 列の共有数式(formula は先頭行 from のときの式) */
export function sharedColumn(col: string, from: number, to: number, formula: string): CellSpec {
  return { ref: `${col}${from}`, formula, sharedRange: `${col}${from}:${col}${to}` };
}

/** 1 セルの数式 */
export function formula(ref: string, text: string): CellSpec {
  return { ref, formula: text };
}
