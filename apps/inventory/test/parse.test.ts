import { describe, expect, it } from "vitest";
import { detectEvent } from "../src/vba/events";
import { parseModuleSource, splitCode } from "../src/vba/parse";

describe("splitCode", () => {
  it("文字列内のアポストロフィはコメントとみなさない", () => {
    const r = splitCode(`MsgBox "It's ""OK""" ' 確認`);
    expect(r.code).toBe(`MsgBox "It's ""OK"""`);
    expect(r.bare).toBe(`MsgBox ""`);
    expect(r.strings).toEqual([`It's "OK"`]);
  });

  it("Rem 文はコメント", () => {
    expect(splitCode("  Rem 古い処理").code).toBe("");
  });
});

describe("parseModuleSource", () => {
  const src = `Option Explicit
Private Declare PtrSafe Function GetTickCount64 Lib "kernel32" () As LongLong
Declare Function FindWindow Lib "user32" Alias "FindWindowA" (ByVal cls As String, ByVal title As String) As Long
Private WithEvents app As Application

' 合計を計算する
Public Function 合計(ByRef 配列() As Double, Optional ByVal 開始 As Long = 0, _
                     ParamArray 追加() As Variant) As Double
    On Error GoTo エラー
    合計 = 0
    Exit Function
エラー:
    合計 = -1
End Function

Private Static Sub カウント()
    On Error Resume Next
End Sub

Friend Property Get 名前() As String()
End Property

Function 古い名前$(x%, y)
End Function`;
  const m = parseModuleSource(src);

  it("行数・コメント行・Option Explicit", () => {
    expect(m.lineCount).toBe(24);
    expect(m.commentLineCount).toBe(1);
    expect(m.hasOptionExplicit).toBe(true);
    expect(m.withEvents).toEqual(["app"]);
  });

  it("Declare 文(PtrSafe の有無と Alias)", () => {
    expect(m.declares).toEqual([
      { name: "GetTickCount64", lib: "kernel32", alias: null, ptrSafe: true, line: 2, legacyBranch: false },
      { name: "FindWindow", lib: "user32", alias: "FindWindowA", ptrSafe: false, line: 3, legacyBranch: false },
    ]);
  });

  it("プロシージャの種類・スコープ・行範囲(行継続を含む)", () => {
    expect(m.procedures.map((p) => [p.name, p.kind, p.scope, p.isStatic, p.startLine, p.endLine])).toEqual([
      ["合計", "function", "public", false, 7, 14],
      ["カウント", "sub", "private", true, 16, 18],
      ["名前", "propertyGet", "friend", false, 20, 21],
      ["古い名前", "function", "public", false, 23, 24],
    ]);
  });

  it("引数と戻り値の型", () => {
    const total = m.procedures[0];
    expect(total.returnType).toBe("Double");
    expect(total.params).toEqual([
      { name: "配列", type: "Double", byVal: false, optional: false, paramArray: false, isArray: true, defaultValue: null },
      { name: "開始", type: "Long", byVal: true, optional: true, paramArray: false, isArray: false, defaultValue: "0" },
      { name: "追加", type: "Variant", byVal: false, optional: false, paramArray: true, isArray: true, defaultValue: null },
    ]);
    expect(m.procedures[2].returnType).toBe("String()");
    expect(m.procedures[3].returnType).toBe("String");
    expect(m.procedures[3].params.map((p) => [p.name, p.type])).toEqual([
      ["x", "Integer"],
      ["y", null],
    ]);
  });

  it("エラー処理の有無", () => {
    expect(m.procedures.map((p) => p.errorHandling)).toEqual(["handler", "resumeNext", "none", "none"]);
  });

  it("各行がどのプロシージャに属するか", () => {
    const procOf = (line: number) => m.lines.find((l) => l.start <= line && line <= l.end)!.proc;
    expect(procOf(1)).toBe(-1);
    expect(procOf(8)).toBe(0); // 継続行は宣言と同じ論理行
    expect(procOf(17)).toBe(1);
  });
});

describe("detectEvent", () => {
  it("ブック・シート・フォーム・コントロールのイベント", () => {
    expect(detectEvent("Workbook_Open", "ThisWorkbook", "document", [])?.label).toBe("ブック / 開いたとき");
    expect(detectEvent("Worksheet_Change", "Sheet1", "document", [], "売上")?.label).toBe("シート「売上」 / 値が変更されたとき");
    expect(detectEvent("btn_OK_Click", "UserForm1", "form", [])?.label).toBe("btn_OK(UserForm1) / クリックしたとき");
    expect(detectEvent("Form_Load", "Form_受注入力", "form", [])?.label).toBe("フォーム 受注入力 / 読み込まれたとき");
    expect(detectEvent("Auto_Open", "Module1", "standard", [])).toEqual({ label: "ブックを開いたとき(Auto_Open)", auto: true });
  });

  it("イベントでないもの", () => {
    expect(detectEvent("Get_Close", "Class1", "class", [])).toBeNull();
    expect(detectEvent("集計_Click", "Module1", "standard", [])).toBeNull();
    expect(detectEvent("app_SheetChange", "Class1", "class", ["app"])?.label).toBe("app(Class1) / いずれかのシートの値が変更されたとき");
  });
});

describe("パスワードのマスク", () => {
  it("接続文字列リテラル内だけを伏せる", async () => {
    const { maskSecretsInSource } = await import("../src/secrets");
    const src = `cn.Open "Provider=SQLOLEDB;Password=abc;User ID=sa"\nPwd = txtPwd.Value\ns = "PWD=xyz;DSN=a"`;
    expect(maskSecretsInSource(src)).toBe(`cn.Open "Provider=SQLOLEDB;Password=****;User ID=sa"\nPwd = txtPwd.Value\ns = "PWD=****;DSN=a"`);
  });
});

describe("解析の正しさ(誤検知・見逃しの修正)", async () => {
  const { analyzeVbaProject } = await import("../src/vba/analyze");
  const { detectFindings } = await import("../src/findings");
  const project = (modules: { name: string; type?: "standard" | "class"; source: string }[]) => ({
    name: "VBAProject",
    codePage: 932,
    encoding: "cp932",
    lockedForViewing: false,
    hasPassword: false,
    references: [],
    modules: modules.map((m) => ({ name: m.name, streamName: m.name, type: m.type ?? ("standard" as const), source: m.source, attributes: {} })),
  });

  it("#If VBA7 / Win64 の #Else 側にある PtrSafe なしの Declare は、64ビット版のリスクにしない", () => {
    const src = `#If VBA7 Then
Private Declare PtrSafe Function GetTickCount Lib "kernel32" () As Long
#Else
Private Declare Function GetTickCount Lib "kernel32" () As Long
#End If
#If Win64 Then
Private Declare PtrSafe Function A1 Lib "user32" () As LongLong
#ElseIf VBA7 Then
Private Declare PtrSafe Function A1 Lib "user32" () As Long
#Else
Private Declare Function A1 Lib "user32" () As Long
#End If
#If Not VBA7 Then
Private Declare Function B1 Lib "user32" () As Long
#End If
#If Mac Then
#Else
Private Declare Function C1 Lib "user32" () As Long
#End If
Private Declare Function D1 Lib "user32" () As Long`;
    const m = parseModuleSource(src);
    expect(m.declares.map((d) => [d.name, d.ptrSafe, d.legacyBranch])).toEqual([
      ["GetTickCount", true, false],
      ["GetTickCount", false, true],
      ["A1", true, false],
      ["A1", true, true],
      ["A1", false, true],
      ["B1", false, true],
      ["C1", false, false],
      ["D1", false, false],
    ]);
    const a = analyzeVbaProject(project([{ name: "Module1", source: src }]), { host: "excel", includeSource: false });
    const findings = detectFindings(
      { excel: null, access: null, vba: a.project, dependencies: a.dependencies, callGraph: a.callGraph, entryPoints: a.entryPoints },
      { credentialLocations: [] },
    );
    expect(findings.find((f) => f.ruleId === "VBA-API-64BIT")?.locations).toEqual([
      { module: "Module1", line: 18 },
      { module: "Module1", line: 20 },
    ]);
    expect(findings.find((f) => f.ruleId === "WIN-API")?.count).toBe(8);
  });

  it("1行で書いたプロシージャ(Sub A(): …: End Sub)の行範囲", () => {
    const m = parseModuleSource(`Sub A(): MsgBox "a: End Sub": End Sub\nSub B()\n    MsgBox 1\nEnd Sub`);
    expect(m.procedures.map((p) => [p.name, p.startLine, p.endLine])).toEqual([
      ["A", 1, 1],
      ["B", 2, 4],
    ]);
  });

  it("ローカル変数・モジュールの変数・For の変数・名前付き引数は、同名のプロシージャの呼び出しとみなさない", () => {
    const a = analyzeVbaProject(
      project([
        {
          name: "Module1",
          source: `Private 合計 As Long
Sub Main()
    Dim 件数 As Long, 単価(1 To 3) As Long
    件数 = 件数 + 1
    合計 = 0
    For Each 行 In Range("A1:A3")
    Next
    Call 出力(ファイル:="a.csv")
    単価(1) = 100
    集計
End Sub`,
        },
        { name: "Module2", source: "Public Sub 件数()\nEnd Sub\nPublic Sub 合計()\nEnd Sub\nPublic Sub 行()\nEnd Sub\nPublic Sub ファイル()\nEnd Sub\nPublic Sub 単価()\nEnd Sub\nPublic Sub 出力(ファイル)\nEnd Sub\nPublic Sub 集計()\nEnd Sub" },
      ]),
      { host: "excel", includeSource: false },
    );
    expect(a.callGraph.map((e) => e.to).sort()).toEqual(["Module2.出力", "Module2.集計"]);
  });

  it("Property Get / Let のように同じ名前のプロシージャは ID を区別する", () => {
    const a = analyzeVbaProject(
      project([
        { name: "CCustomer", type: "class", source: "Public Property Get 名前() As String\nEnd Property\nPublic Property Let 名前(ByVal v As String)\nEnd Property" },
      ]),
      { host: "excel", includeSource: false },
    );
    const ids = a.project.modules[0].procedures.map((p) => p.id);
    expect(ids).toEqual(["CCustomer.名前", "CCustomer.名前(Let)"]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
