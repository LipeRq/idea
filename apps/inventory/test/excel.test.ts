import CFB from "cfb";
import { describe, expect, it } from "vitest";
import { analyzeBuffer, InventoryReportSchema, UnsupportedFileError } from "../src";
import { buildXls, buildXlsb, buildXlsm } from "./helpers/workbooks";
import { SAMPLE_PROJECT } from "./helpers/sampleVba";

const now = new Date("2026-10-18T00:00:00Z");
const xlsm = analyzeBuffer(buildXlsm(SAMPLE_PROJECT), "売上管理.xlsm", { now });

describe(".xlsm の解析", () => {
  it("スキーマどおりの JSON になる", () => {
    expect(() => InventoryReportSchema.parse(JSON.parse(JSON.stringify(xlsm)))).not.toThrow();
    expect(xlsm.file).toMatchObject({ name: "売上管理.xlsm", format: "xlsm", kind: "excel" });
    expect(xlsm.file.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(xlsm.generatedAt).toBe("2026-10-18T00:00:00.000Z");
    expect(xlsm.warnings).toEqual([]);
  });

  it("文書プロパティ", () => {
    expect(xlsm.properties).toMatchObject({
      title: "売上管理",
      creator: "山田太郎",
      lastModifiedBy: "佐藤花子",
      company: "株式会社サンプル商事",
      modified: "2023-03-31T18:30:00Z",
    });
  });

  it("シート一覧・使用範囲・数式(共有数式の子セルも数える)", () => {
    const [sales, settings] = xlsm.excel!.sheets;
    expect(sales).toMatchObject({ name: "売上", codeName: "Sheet1", state: "visible", usedRange: "A1:F20", formulaCount: 7 });
    expect(sales.formulaSamples[0]).toEqual({ cell: "D2", formula: "B2*C2" });
    expect(sales.formulaSamples.map((s) => s.formula)).toContain('SUM(D2:D20)&"円"');
    expect(sales.externalRefCount).toBe(1);
    expect(sales.brokenRefCount).toBe(1);
    expect(settings).toMatchObject({ name: "設定", state: "veryHidden", formulaCount: 0 });
    expect(xlsm.stats.formulaCount).toBe(7);
  });

  it("名前定義・外部リンク・データ接続(パスワードはマスク)", () => {
    const excel = xlsm.excel!;
    expect(excel.definedNames.map((n) => [n.name, n.scope, n.refersTo, n.builtIn])).toEqual([
      ["_xlnm.Print_Area", "売上", "売上!$A$1:$F$20", true],
      ["税率", null, "設定!$B$2", false],
      ["古い範囲", null, "#REF!$A$1", false],
    ]);
    expect(excel.externalLinks).toEqual([
      { index: 1, type: "workbook", target: "file:///\\\\fileserver\\share\\単価表.xlsx", sheetNames: ["単価表"] },
    ]);
    expect(excel.connections.map((c) => c.type)).toEqual(["OLE DB", "Power Query"]);
    expect(excel.connections[0].connectionString).toContain("Password=****;");
    expect(JSON.stringify(xlsm)).not.toContain("secret123");
    expect(JSON.stringify(xlsm)).not.toContain("P@ssw0rd");
  });

  it("ボタン・図形に登録されたマクロ(フォームコントロールの重複はまとめる)", () => {
    expect(xlsm.excel!.controlMacros).toEqual([
      { sheet: "売上", control: "Button 1", text: "集計実行", macro: "売上集計.集計実行" },
      { sheet: "売上", control: "正方形/長方形 1", text: "CSV出力", macro: "売上集計.CSV出力" },
    ]);
  });

  it("プロシージャ一覧と行範囲", () => {
    const sales = xlsm.vba!.modules.find((m) => m.name === "売上集計")!;
    expect(sales.procedures.map((p) => p.name)).toEqual([
      "集計実行",
      "明細出力",
      "税込金額",
      "CSV出力",
      "定時バックアップ",
      "初期化",
      "再計算",
      "長い引数",
      "未使用の手動マクロ",
    ]);
    const tax = sales.procedures.find((p) => p.name === "税込金額")!;
    expect(tax).toMatchObject({ kind: "function", returnType: "Currency", startLine: 32, endLine: 34 });
    expect(tax.params.map((p) => [p.name, p.type, p.optional, p.defaultValue])).toEqual([
      ["金額", "Currency", false, null],
      ["税率", "Double", true, "0.1"],
    ]);
    expect(sales.procedures.find((p) => p.name === "長い引数")).toMatchObject({ startLine: 57, endLine: 61 });
    expect(xlsm.stats).toMatchObject({ moduleCount: 5, procedureCount: 16 });
  });

  it("呼び出し関係(直接呼び出し・Application.Run・OnTime・フォーム表示)", () => {
    const edges = xlsm.callGraph.map((e) => `${e.from} -${e.kind}-> ${e.to}`);
    expect(edges).toEqual(
      expect.arrayContaining([
        "ThisWorkbook.Workbook_Open -call-> 売上集計.初期化",
        "ThisWorkbook.Workbook_Open -run-> 売上集計.定時バックアップ",
        "Sheet1.Worksheet_Change -call-> 売上集計.再計算",
        "売上集計.集計実行 -call-> 売上集計.明細出力",
        "売上集計.初期化 -formShow-> UserForm1",
        "売上集計.再計算 -run-> 売上集計.集計実行",
        "UserForm1.CommandButton1_Click -call-> 売上集計.集計実行",
      ]),
    );
    expect(edges).toHaveLength(7);
    const run = xlsm.vba!.modules[2].procedures.find((p) => p.name === "集計実行")!;
    expect(run.calledBy.sort()).toEqual(["UserForm1.CommandButton1_Click", "売上集計.再計算"]);
  });

  it("起動のきっかけ(イベント・ボタン・OnTime・手動実行の候補)", () => {
    const eps = xlsm.entryPoints.map((e) => [e.kind, e.trigger, e.procedure]);
    expect(eps).toEqual(
      expect.arrayContaining([
        ["event", "ブック / 開いたとき", "ThisWorkbook.Workbook_Open"],
        ["event", "シート「売上」 / 値が変更されたとき", "Sheet1.Worksheet_Change"],
        ["event", "CommandButton1(UserForm1) / クリックしたとき", "UserForm1.CommandButton1_Click"],
        ["button", "シート「売上」の「集計実行」をクリックしたとき", "売上集計.集計実行"],
        ["button", "シート「売上」の「CSV出力」をクリックしたとき", "売上集計.CSV出力"],
        ["schedule", "時刻を指定して実行(Application.OnTime)", "売上集計.定時バックアップ"],
        ["macro", "マクロ一覧(Alt+F8)などから手動で実行", "売上集計.未使用の手動マクロ"],
      ]),
    );
    expect(eps.some(([, , p]) => p === "CCustomer.Class_Initialize")).toBe(false);
  });

  it("外部依存", () => {
    const deps = xlsm.dependencies.map((d) => `${d.kind}:${d.target}`);
    expect(deps).toEqual(
      expect.arrayContaining([
        "createObject:ADODB.Connection",
        "connectionString:Provider=SQLOLEDB;Data Source=SV01;Initial Catalog=Sales;User ID=sa;Password=****;",
        "sql:SELECT * FROM 売上 WHERE 日付 >= '2024-01-01'",
        "filePath:C:\\Users\\tanaka\\Desktop\\売上.csv",
        "filePath:\\\\fileserver\\share\\売上\\",
        "filePath:C:\\temp\\log.txt",
        "workbook:C:\\データ\\単価表.xlsx",
        "sendKeys:^s",
        "shell:notepad.exe C:\\temp\\log.txt",
        "winApi:kernel32: GetTickCount",
        "externalLink:file:///\\\\fileserver\\share\\単価表.xlsx",
        "reference:Microsoft ActiveX Data Objects 6.1 Library",
      ]),
    );
    const sql = xlsm.dependencies.find((d) => d.kind === "sql")!;
    expect(sql.location).toEqual({ module: "売上集計", procedure: "集計実行", line: 13 });
  });

  it("リスクの検出", () => {
    const ids = Object.fromEntries(xlsm.findings.map((f) => [f.ruleId, f.count]));
    expect(ids).toEqual({
      "VBA-API-64BIT": 1,
      "CRED-HARDCODED": 2,
      SENDKEYS: 1,
      SHELL: 1,
      "HARDCODED-PATH": 4,
      "RESUME-NEXT": 1,
      "NO-ERROR-HANDLING": 2,
      "EXTERNAL-LINK": 1,
      "DATA-CONNECTION": 2,
      "WIN-API": 1,
      "NO-OPTION-EXPLICIT": 2,
      "VERY-HIDDEN-SHEET": 1,
      "BROKEN-REF": 2,
      "VBA-LOCKED": 1,
    });
    expect(xlsm.findings[0].severity).toBe("high");
  });

  it("includeSource: false ならソースを含めない", () => {
    const r = analyzeBuffer(buildXlsm(SAMPLE_PROJECT), "a.xlsm", { includeSource: false });
    expect(r.vba!.modules.every((m) => m.source === null)).toBe(true);
    expect(r.stats.procedureCount).toBe(16);
  });

  it("マクロなしのブック(.xlsx)", () => {
    const r = analyzeBuffer(buildXlsm(null), "a.xlsx");
    expect(r.file.format).toBe("xlsx");
    expect(r.vba).toBeNull();
    expect(r.entryPoints.map((e) => e.procedure)).toEqual([null, null]);
  });
});

describe(".xlsb の解析", () => {
  const r = analyzeBuffer(buildXlsb(SAMPLE_PROJECT), "売上.xlsb");

  it("シート・使用範囲・数式の件数・名前定義", () => {
    expect(r.file.format).toBe("xlsb");
    expect(r.excel!.sheets.map((s) => [s.name, s.codeName, s.state, s.usedRange, s.formulaCount])).toEqual([
      ["売上", "Sheet1", "visible", "A1:D10", 3],
      ["作業用", "Sheet2", "hidden", "A1:D10", 0],
    ]);
    expect(r.excel!.definedNames.map((n) => [n.name, n.scope, n.builtIn])).toEqual([
      ["_xlnm.Print_Area", "売上", true],
      ["単価", null, false],
    ]);
    expect(r.excel!.formulaTextAvailable).toBe(false);
  });

  it("VBA とボタンのマクロ", () => {
    expect(r.vba!.modules.map((m) => m.name)).toContain("売上集計");
    expect(r.entryPoints.find((e) => e.kind === "button")?.procedure).toBe("売上集計.集計実行");
    expect(r.entryPoints.find((e) => e.kind === "event" && e.procedure === "Sheet1.Worksheet_Change")?.trigger).toBe(
      "シート「売上」 / 値が変更されたとき",
    );
  });
});

describe(".xls(BIFF8)の解析", () => {
  const r = analyzeBuffer(buildXls(SAMPLE_PROJECT), "古い集計.xls");

  it("シート・XLMマクロシート・名前定義・外部ブック参照", () => {
    expect(r.file.format).toBe("xls");
    expect(r.excel!.sheets.map((s) => [s.name, s.codeName, s.kind, s.state, s.usedRange, s.formulaCount])).toEqual([
      ["集計", "Sheet1", "worksheet", "visible", "A1:E12", 4],
      ["マクロ", "Macro1", "macrosheet", "hidden", "A1:E12", 0],
    ]);
    expect(r.excel!.definedNames.map((n) => [n.name, n.scope, n.builtIn])).toEqual([
      ["Print_Area", "集計", true],
      ["税率", null, false],
    ]);
    expect(r.excel!.externalLinks).toEqual([{ index: 1, type: "workbook", target: "C:\\データ\\単価表.xls", sheetNames: ["単価表"] }]);
    expect(r.findings.map((f) => f.ruleId)).toContain("XLM-MACRO");
  });

  it("_VBA_PROJECT_CUR から VBA(cp932)を読む", () => {
    const sales = r.vba!.modules.find((m) => m.name === "売上集計")!;
    expect(sales.source).toContain("' 売上データを集計してCSVに出力する");
    expect(r.vba!.lockedForViewing).toBe(true);
  });

  it("SummaryInformation の文書プロパティ", () => {
    expect(r.properties).toMatchObject({ creator: "Yamada", lastModifiedBy: "Sato", created: "2010-05-06T07:08:09.000Z" });
  });
});

describe("非対応ファイル", () => {
  it("形式が判定できなければ UnsupportedFileError", () => {
    expect(() => analyzeBuffer(new TextEncoder().encode("hello"), "memo.txt")).toThrow(UnsupportedFileError);
  });

  it("パスワードで暗号化されたブック", () => {
    const container = CFB.utils.cfb_new();
    CFB.utils.cfb_add(container, "/EncryptionInfo", Buffer.from([4, 0, 4, 0]));
    CFB.utils.cfb_add(container, "/EncryptedPackage", Buffer.alloc(16));
    const data = new Uint8Array(CFB.write(container, { type: "buffer" }) as Buffer);
    expect(() => analyzeBuffer(data, "secret.xlsx")).toThrow("暗号化されたブック");
  });
});
