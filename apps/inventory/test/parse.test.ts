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
      { name: "GetTickCount64", lib: "kernel32", alias: null, ptrSafe: true, line: 2 },
      { name: "FindWindow", lib: "user32", alias: "FindWindowA", ptrSafe: false, line: 3 },
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
