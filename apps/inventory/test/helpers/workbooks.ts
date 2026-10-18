// テスト用の合成ブック(.xlsm / .xlsb / .xls)を組み立てる。
import CFB from "cfb";
import { strToU8, zipSync } from "fflate";
import { addStreams, buildVbaProjectBin, buildVbaStreams, type TestProject } from "./ovba";

const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";

function rels(list: { id: string; type: string; target: string; external?: boolean }[]): string {
  const items = list
    .map(
      (r) =>
        `<Relationship Id="${r.id}" Type="${r.type.startsWith("http") ? r.type : `${REL}/${r.type}`}" Target="${r.target}"${r.external ? ' TargetMode="External"' : ""}/>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${PKG_REL}">${items}</Relationships>`;
}

const CORE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>売上管理</dc:title><dc:creator>山田太郎</dc:creator><cp:lastModifiedBy>佐藤花子</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">2015-04-01T09:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2023-03-31T18:30:00Z</dcterms:modified></cp:coreProperties>`;

const APP = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Excel</Application><Company>株式会社サンプル商事</Company><AppVersion>16.0300</AppVersion></Properties>`;

function rootRels(workbook: string) {
  return rels([
    { id: "rId1", type: "officeDocument", target: workbook },
    { id: "rId2", type: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", target: "docProps/core.xml" },
    { id: "rId3", type: "extended-properties", target: "docProps/app.xml" },
  ]);
}

const SHEET1_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">
<sheetPr codeName="Sheet1"/><dimension ref="A1:F20"/>
<sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" s="1"/></row>
<row r="2"><c r="D2"><f>B2*C2</f><v>100</v></c><c r="E2"><f>[1]単価表!$B$2</f><v>5</v></c><c r="F2" t="str"><f>SUM(D2:D20)&amp;"円"</f><v>300円</v></c></row>
<row r="3"><c r="D3"><f t="shared" ref="D3:D5" si="0">B3*C3</f><v>1</v></c></row>
<row r="4"><c r="D4"><f t="shared" si="0"/><v>2</v></c></row>
<row r="5"><c r="D5"><f t="shared" si="0"/><v>3</v></c><c r="E5"><f>#REF!*2</f><v>0</v></c></row>
</sheetData>
<drawing r:id="rId1"/><legacyDrawing r:id="rId2"/>
<mc:AlternateContent><mc:Choice Requires="x14"><controls><mc:AlternateContent><mc:Choice Requires="x14"><control shapeId="1025" r:id="rId3" name="Button 1"><controlPr defaultSize="0" print="0" autoFill="0" autoPict="0" macro="[0]!売上集計.集計実行"/></control></mc:Choice></mc:AlternateContent></controls></mc:Choice></mc:AlternateContent>
</worksheet>`;

const SHEET2_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr codeName="Sheet2"/><dimension ref="A1:B5"/><sheetData/></worksheet>`;

const DRAWING_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<xdr:twoCellAnchor><xdr:from/><xdr:to/><xdr:sp macro="[0]!売上集計.CSV出力" textlink=""><xdr:nvSpPr><xdr:cNvPr id="2" name="正方形/長方形 1"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:txBody><a:p><a:r><a:t>CSV出力</a:t></a:r></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:twoCellAnchor>
</xdr:wsDr>`;

const VML = `<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<v:shape id="_x0000_s1025" type="#_x0000_t201"><v:textbox><div style="text-align:center"><font face="ＭＳ Ｐゴシック" size="220">集計実行</font></div></v:textbox><x:ClientData ObjectType="Button"><x:Anchor>1, 0, 1, 0, 3, 0, 3, 0</x:Anchor><x:FmlaMacro>[0]!売上集計.集計実行</x:FmlaMacro></x:ClientData></v:shape>
<v:shape id="_x0000_s1026" type="#_x0000_t202"><v:textbox><div>メモ</div></v:textbox><x:ClientData ObjectType="Note"><x:Row>0</x:Row></x:ClientData></v:shape>
</xml>`;

export function buildXlsm(project: TestProject | null = null): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/></Types>`,
    ),
    "_rels/.rels": strToU8(rootRels("xl/workbook.xml")),
    "docProps/core.xml": strToU8(CORE),
    "docProps/app.xml": strToU8(APP),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}"><workbookPr codeName="ThisWorkbook"/>
<sheets><sheet name="売上" sheetId="1" r:id="rId1"/><sheet name="設定" sheetId="2" state="veryHidden" r:id="rId2"/></sheets>
<externalReferences><externalReference r:id="rId5"/></externalReferences>
<definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">売上!$A$1:$F$20</definedName><definedName name="税率">設定!$B$2</definedName><definedName name="古い範囲" hidden="1">#REF!$A$1</definedName></definedNames>
</workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(
      rels([
        { id: "rId1", type: "worksheet", target: "worksheets/sheet1.xml" },
        { id: "rId2", type: "worksheet", target: "worksheets/sheet2.xml" },
        ...(project ? [{ id: "rId3", type: "http://schemas.microsoft.com/office/2006/relationships/vbaProject", target: "vbaProject.bin" }] : []),
        { id: "rId4", type: "connections", target: "connections.xml" },
        { id: "rId5", type: "externalLink", target: "externalLinks/externalLink1.xml" },
      ]),
    ),
    "xl/worksheets/sheet1.xml": strToU8(SHEET1_XML),
    "xl/worksheets/sheet2.xml": strToU8(SHEET2_XML),
    "xl/worksheets/_rels/sheet1.xml.rels": strToU8(
      rels([
        { id: "rId1", type: "drawing", target: "../drawings/drawing1.xml" },
        { id: "rId2", type: "vmlDrawing", target: "../drawings/vmlDrawing1.vml" },
        { id: "rId3", type: "ctrlProp", target: "../ctrlProps/ctrlProp1.xml" },
      ]),
    ),
    "xl/drawings/drawing1.xml": strToU8(DRAWING_XML),
    "xl/drawings/vmlDrawing1.vml": strToU8(VML),
    "xl/connections.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<connections xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><connection id="1" name="販売管理DB" type="5" refreshedVersion="6"><dbPr connection="Provider=SQLOLEDB.1;Password=secret123;Persist Security Info=True;User ID=sales;Initial Catalog=販売;Data Source=SV01" command="SELECT * FROM 受注" commandType="2"/></connection><connection id="2" name="クエリ - 顧客" type="5" refreshedVersion="8"><dbPr connection="Provider=Microsoft.Mashup.OleDb.1;Data Source=$Workbook$;Location=顧客" command="SELECT * FROM [顧客]"/></connection></connections>`),
    "xl/externalLinks/externalLink1.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<externalLink xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}"><externalBook r:id="rId1"><sheetNames><sheetName val="単価表"/></sheetNames></externalBook></externalLink>`),
    "xl/externalLinks/_rels/externalLink1.xml.rels": strToU8(
      rels([{ id: "rId1", type: "externalLinkPath", target: "file:///\\\\fileserver\\share\\%E5%8D%98%E4%BE%A1%E8%A1%A8.xlsx", external: true }]),
    ),
  };
  if (project) files["xl/vbaProject.bin"] = buildVbaProjectBin(project);
  return zipSync(files);
}

// ---- .xlsb(BIFF12)----

function biff12(type: number, data: number[] = []): number[] {
  const out: number[] = [];
  if (type >= 0x80) out.push((type & 0x7f) | 0x80, type >> 7);
  else out.push(type);
  let size = data.length;
  do {
    let b = size & 0x7f;
    size >>= 7;
    if (size > 0) b |= 0x80;
    out.push(b);
  } while (size > 0);
  return [...out, ...data];
}

const u32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
function wide(s: string): number[] {
  const out = u32(s.length);
  for (const c of s) {
    const code = c.charCodeAt(0);
    out.push(code & 0xff, code >> 8);
  }
  return out;
}

export function buildXlsb(project: TestProject): Uint8Array {
  const workbook = [
    ...biff12(0x83), // BrtBeginBook
    ...biff12(0x99, [...u32(0), ...u32(0), ...wide("ThisWorkbook")]), // BrtWbProp
    ...biff12(0x9c, [...u32(0), ...u32(1), ...wide("rId1"), ...wide("売上")]), // BrtBundleSh
    ...biff12(0x9c, [...u32(1), ...u32(2), ...wide("rId2"), ...wide("作業用")]),
    ...biff12(0x27, [...u32(0x20), 0, ...u32(0), ...wide("_xlnm.Print_Area"), ...u32(0)]), // BrtName
    ...biff12(0x27, [...u32(0), 0, ...u32(0xffffffff), ...wide("単価"), ...u32(0)]),
    ...biff12(0x84), // BrtEndBook
  ];
  const sheet = (formulas: number, codeName: string) => [
    ...biff12(0x81), // BrtBeginSheet
    ...biff12(0x93, [0, ...new Array(18).fill(0), ...wide(codeName)]), // BrtWsProp(コード名は 19 バイト目から)
    ...biff12(0x94, [...u32(0), ...u32(9), ...u32(0), ...u32(3)]), // BrtWsDim: A1:D10
    ...Array.from({ length: formulas }, () => biff12(0x09, new Array(20).fill(0))).flat(), // BrtFmlaNum
    ...biff12(0x02, new Array(16).fill(0)), // BrtCellRk(数式ではないセル)
    ...biff12(0x82),
  ];
  const files: Record<string, Uint8Array> = {
    "_rels/.rels": strToU8(rootRels("xl/workbook.bin")),
    "docProps/core.xml": strToU8(CORE),
    "docProps/app.xml": strToU8(APP),
    "xl/workbook.bin": Uint8Array.from(workbook),
    "xl/_rels/workbook.bin.rels": strToU8(
      rels([
        { id: "rId1", type: "worksheet", target: "worksheets/sheet1.bin" },
        { id: "rId2", type: "worksheet", target: "worksheets/sheet2.bin" },
        { id: "rId3", type: "http://schemas.microsoft.com/office/2006/relationships/vbaProject", target: "vbaProject.bin" },
      ]),
    ),
    "xl/worksheets/sheet1.bin": Uint8Array.from(sheet(3, "Sheet1")),
    "xl/worksheets/sheet2.bin": Uint8Array.from(sheet(0, "Sheet2")),
    "xl/worksheets/_rels/sheet1.bin.rels": strToU8(rels([{ id: "rId1", type: "vmlDrawing", target: "../drawings/vmlDrawing1.vml" }])),
    "xl/drawings/vmlDrawing1.vml": strToU8(VML),
    "xl/vbaProject.bin": buildVbaProjectBin(project),
  };
  return zipSync(files);
}

// ---- .xls(BIFF8)----

function rec(type: number, data: number[] = []): number[] {
  return [type & 0xff, type >> 8, data.length & 0xff, data.length >> 8, ...data];
}
const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
/** fHighByte=1 の UTF-16 文字列(文字数は呼び出し側で付ける) */
function chars16(s: string): number[] {
  const out = [0x01];
  for (const c of s) {
    const code = c.charCodeAt(0);
    out.push(code & 0xff, code >> 8);
  }
  return out;
}

export function buildXls(project: TestProject): Uint8Array {
  const bof = (dt: number) => rec(0x0809, [...u16(0x0600), ...u16(dt), ...u16(0x0dbb), ...u16(0x07cc), ...u32(0), ...u32(0x06)]);
  const sheetStream = (formulas: number, codeName: string) => [
    ...bof(0x10),
    ...rec(0x01ba, [...u16(codeName.length), ...chars16(codeName)]),
    ...rec(0x0200, [...u32(0), ...u32(12), ...u16(0), ...u16(5), ...u16(0)]), // A1:E12
    ...Array.from({ length: formulas }, () => rec(0x0006, new Array(22).fill(0))).flat(),
    ...rec(0x000a),
  ];
  const sheets = [
    { name: "集計", state: 0, dt: 0, body: sheetStream(4, "Sheet1") },
    { name: "マクロ", state: 1, dt: 1, body: sheetStream(0, "Macro1") },
  ];
  const supbookPath = "\u0001\u0001Cデータ\u0003単価表.xls"; // 符号化パス: 先頭 0x01、0x01 + ドライブ文字 = "C:\"、0x03 = "\"
  const globalsWithout = (offsets: number[]) => [
    ...bof(0x05),
    ...rec(0x0042, u16(1200)), // CODEPAGE
    ...rec(0x01ba, [...u16(12), ...chars16("ThisWorkbook")]),
    ...sheets.flatMap((s, i) => rec(0x0085, [...u32(offsets[i]), s.state, s.dt, s.name.length, ...chars16(s.name)])),
    ...rec(0x01ae, [...u16(2), ...u16(0x0401)]), // 自ブック
    ...rec(0x01ae, [...u16(1), ...u16(supbookPath.length), ...chars16(supbookPath), ...u16(3), ...chars16("単価表")]),
    ...rec(0x0018, [0x20, 0x00, 0, 1, ...u16(0), ...u16(0), ...u16(1), 0, 0, 0, 0, 0x00, 0x06]), // Print_Area(組み込み)
    ...rec(0x0018, [0x00, 0x00, 0, 2, ...u16(0), ...u16(0), ...u16(0), 0, 0, 0, 0, ...chars16("税率")]),
    ...rec(0x000a),
  ];
  let globals = globalsWithout([0, 0]);
  const offsets: number[] = [];
  let pos = globals.length;
  for (const s of sheets) {
    offsets.push(pos);
    pos += s.body.length;
  }
  globals = globalsWithout(offsets);
  const workbook = Uint8Array.from([...globals, ...sheets.flatMap((s) => s.body)]);

  const container = CFB.utils.cfb_new();
  CFB.utils.cfb_add(container, "/Workbook", Buffer.from(workbook));
  addStreams(container, "_VBA_PROJECT_CUR", buildVbaStreams(project));
  CFB.utils.cfb_add(container, "/\u0005SummaryInformation", Buffer.from(summaryInformation()));
  return new Uint8Array(CFB.write(container, { type: "buffer", fileType: "cfb" }) as Buffer);
}

/** SummaryInformation(作成者・最終更新者・作成日時) */
function summaryInformation(): Uint8Array {
  const lpstr = (s: string) => {
    const bytes = [...s].map((c) => c.charCodeAt(0));
    return [...u32(bytes.length + 1), ...bytes, 0, ...new Array((4 - ((bytes.length + 1) % 4)) % 4).fill(0)];
  };
  const filetime = (iso: string) => {
    const ticks = (BigInt(Date.parse(iso)) + 11_644_473_600_000n) * 10_000n;
    return [...u32(Number(ticks & 0xffffffffn)), ...u32(Number(ticks >> 32n))];
  };
  const props: [number, number[]][] = [
    [1, [...u16(2), 0, 0, ...u16(1252), 0, 0]],
    [4, [...u16(0x1e), 0, 0, ...lpstr("Yamada")]],
    [8, [...u16(0x1e), 0, 0, ...lpstr("Sato")]],
    [12, [...u16(0x40), 0, 0, ...filetime("2010-05-06T07:08:09Z")]],
  ];
  const headerSize = 8 + props.length * 8;
  let offset = headerSize;
  const index: number[] = [];
  const values: number[] = [];
  for (const [pid, v] of props) {
    index.push(...u32(pid), ...u32(offset));
    values.push(...v);
    offset += v.length;
  }
  const section = [...u32(headerSize + values.length), ...u32(props.length), ...index, ...values];
  const fmtid = [0xe0, 0x85, 0x9f, 0xf2, 0xf9, 0x4f, 0x68, 0x10, 0xab, 0x91, 0x08, 0x00, 0x2b, 0x27, 0xb3, 0xd9];
  return Uint8Array.from([...u16(0xfffe), ...u16(0), ...u32(0x00020006), ...new Array(16).fill(0), ...u32(1), ...fmtid, ...u32(48), ...section]);
}
