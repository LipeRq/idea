// 見積書作成.xlsm: 比べるための「比較的きれいな」ブック。処理の中心は数式で、マクロは採番・PDF保存・履歴記録の補助だけ。
// 仕込んだ問題は 1 つだけ(シートのモジュールに Option Explicit がない)。保存先はブックと同じフォルダからの相対指定で、
// エラー処理もあるため、リスクは「低」だけになり、移行先の候補は「Excel のまま整理」が先頭に来ることを確かめる。
import type { SampleDefinition } from "../lib/types";
import { formula, rowLabels, sharedColumn } from "../lib/workbook";
import { documentModule, vba } from "../lib/vba";

const SHEET_QUOTE = vba`
Private Sub Worksheet_Change(ByVal Target As Range)
    ' 品番は大文字にそろえる(単価表の検索で一致させるため)
    If Intersect(Target, Me.Range("B15:B34")) Is Nothing Then Exit Sub
    Application.EnableEvents = False
    Dim c As Range
    For Each c In Intersect(Target, Me.Range("B15:B34"))
        c.Value = UCase(Trim(c.Value))
    Next c
    Application.EnableEvents = True
End Sub
`;

const MOD_QUOTE = vba`
Option Explicit

' 見積書の作成補助
' 見積番号の採番、PDF保存、見積履歴への記録を行う
' PDF はこのブックと同じフォルダの「見積書PDF」フォルダに保存する

Public Sub 新しい見積書()
    With Worksheets("見積書")
        .Range("B15:B34,E15:E34").ClearContents
        .Range("C5:C8").ClearContents
        .Range("H3").Value = 次の見積番号()
        .Range("H4").Value = Date
    End With
End Sub

Public Sub PDFで保存()
    Dim 保存先 As String
    Dim ファイル名 As String
    On Error GoTo エラー処理
    保存先 = ThisWorkbook.Path & Application.PathSeparator & "見積書PDF"
    If Dir(保存先, vbDirectory) = "" Then MkDir 保存先
    With Worksheets("見積書")
        If .Range("C5").Value = "" Then
            MsgBox "宛先(会社名)を入力してください", vbExclamation
            Exit Sub
        End If
        ファイル名 = 保存先 & Application.PathSeparator & .Range("H3").Value & "_" & .Range("C5").Value & ".pdf"
        .ExportAsFixedFormat Type:=xlTypePDF, Filename:=ファイル名
    End With
    Call 履歴に記録(ファイル名)
    MsgBox "保存しました: " & ファイル名, vbInformation
    Exit Sub
エラー処理:
    MsgBox "PDFの保存に失敗しました。" & vbCrLf & Err.Description, vbExclamation
End Sub

Private Function 次の見積番号() As String
    Dim 接頭辞 As String
    接頭辞 = "Q" & Format(Date, "yymm") & "-"
    次の見積番号 = 接頭辞 & Format(Application.WorksheetFunction.CountIf(Worksheets("見積履歴").Range("A:A"), 接頭辞 & "*") + 1, "000")
End Function

Private Sub 履歴に記録(ByVal ファイル名 As String)
    Dim 行 As Long
    With Worksheets("見積履歴")
        行 = .Cells(.Rows.Count, 1).End(xlUp).Row + 1
        .Cells(行, 1).Value = Worksheets("見積書").Range("H3").Value
        .Cells(行, 2).Value = Worksheets("見積書").Range("H4").Value
        .Cells(行, 3).Value = Worksheets("見積書").Range("C5").Value
        .Cells(行, 4).Value = Worksheets("見積書").Range("G40").Value
        .Cells(行, 5).Value = ファイル名
    End With
End Sub
`;

export const MITSUMORI: SampleDefinition = {
  file: "見積書作成.xlsm",
  title: "見積書作成(比較用: 問題の少ないブック)",
  description:
    "営業が見積書を作るためのブックです。計算は数式で行い、マクロは見積番号の採番・PDF保存・履歴の記録だけを補助しています。ほかのサンプルと比べるための、問題の少ない例です。",
  highlights: [
    "処理の中心は数式(100 個以上)で、マクロは補助的。作り直すより「Excel のまま整理」が候補の先頭に来る",
    "保存先はブックと同じフォルダからの相対指定で、PDF保存にはエラー処理もある",
    "検出されるリスクは「低」の 1 件だけ(シートのモジュールに、変数の宣言を強制する Option Explicit がない)",
  ],
  workbook: {
    properties: {
      title: "見積書",
      creator: "佐藤花子",
      lastModifiedBy: "佐藤花子",
      created: "2021-06-14T13:00:00Z",
      modified: "2023-11-02T16:40:00Z",
      company: "株式会社サンプル精工",
    },
    sheets: [
      {
        name: "見積書",
        codeName: "Sheet1",
        columnWidths: { 2: 14, 3: 30 },
        cells: [
          { ref: "D2", value: "御見積書" },
          ...rowLabels("G3", ["見積番号"]),
          ...rowLabels("G4", ["見積日"]),
          ...rowLabels("B5", ["宛先"]),
          ...rowLabels("B6", ["件名"]),
          ...rowLabels("B7", ["納期"]),
          ...rowLabels("B8", ["有効期限"]),
          { ref: "G8", value: "掛率" },
          { ref: "H8", value: 1 },
          ...rowLabels("B14", ["品番", "品名", "仕様", "数量", "単価", "金額"]),
          sharedColumn("C", 15, 34, 'IF(B15="","",IFERROR(VLOOKUP(B15,単価表!$A$5:$D$200,2,FALSE),"品番なし"))'),
          sharedColumn("D", 15, 34, 'IF(B15="","",IFERROR(VLOOKUP(B15,単価表!$A$5:$D$200,3,FALSE),""))'),
          sharedColumn("F", 15, 34, 'IF(B15="","",IFERROR(ROUND(VLOOKUP(B15,単価表!$A$5:$D$200,4,FALSE)*掛率,0),0))'),
          sharedColumn("G", 15, 34, 'IF(OR(E15="",F15=""),"",E15*F15)'),
          { ref: "F37", value: "小計" },
          formula("G37", "SUM(G15:G34)"),
          { ref: "F38", value: "消費税" },
          formula("G38", "ROUNDDOWN(G37*消費税率,0)"),
          { ref: "F40", value: "合計" },
          formula("G40", "G37+G38"),
          { ref: "B10", value: "御見積金額" },
          formula("C10", 'TEXT(G40,"#,##0")&"円(税込)"'),
        ],
        buttons: [
          { kind: "form", text: "新しい見積書", macro: "新しい見積書", col: 9, row: 2, cols: 2, rows: 2 },
          { kind: "form", text: "PDFで保存", macro: "PDFで保存", col: 9, row: 5, cols: 2, rows: 2 },
        ],
      },
      {
        name: "単価表",
        codeName: "Sheet2",
        cells: [
          { ref: "F2", value: "利益率" },
          { ref: "G2", value: 0.25 },
          ...rowLabels("A4", ["品番", "品名", "仕様", "販売単価", "原価"]),
          ...rowLabels("A5", ["P-1001", "精密シャフト", "φ10 L=120 SUS304"]),
          { ref: "E5", value: 960 },
          ...rowLabels("A6", ["P-1003", "精密シャフト", "φ12 L=150 SUS304"]),
          { ref: "E6", value: 1160 },
          ...rowLabels("A7", ["P-2040", "アルミブラケット", "小 A5052 アルマイト"]),
          { ref: "E7", value: 540 },
          sharedColumn("D", 5, 64, 'IF(E5="","",ROUND(E5*(1+利益率),-1))'),
        ],
      },
      {
        name: "見積履歴",
        codeName: "Sheet3",
        cells: [...rowLabels("A1", ["見積番号", "見積日", "宛先", "金額(税込)", "PDF"])],
      },
    ],
    definedNames: [
      { name: "_xlnm.Print_Area", localSheetId: 0, refersTo: "見積書!$A$1:$H$42" },
      { name: "掛率", refersTo: "見積書!$H$8" },
      { name: "利益率", refersTo: "単価表!$G$2" },
      { name: "消費税率", refersTo: "0.1" },
    ],
    vba: {
      modules: [
        documentModule("ThisWorkbook"),
        documentModule("Sheet1", SHEET_QUOTE),
        documentModule("Sheet2"),
        documentModule("Sheet3"),
        { name: "mod見積", type: "standard", code: MOD_QUOTE },
      ],
    },
  },
  expect: {
    findings: ["NO-OPTION-EXPLICIT"],
    absentFindings: [
      "CRED-HARDCODED",
      "VBA-API-64BIT",
      "HARDCODED-PATH",
      "NO-ERROR-HANDLING",
      "RESUME-NEXT",
      "SENDKEYS",
      "SHELL",
      "UNUSED-PRIVATE",
      "EXTERNAL-LINK",
      "BROKEN-REF",
    ],
    entryKinds: ["button", "event"],
    dependencyKinds: ["fileIo"],
    complexity: "低",
    firstMigration: "Excel のまま整理",
    checks: (r) => {
      const problems: string[] = [];
      if (r.findings.some((f) => f.severity !== "low")) problems.push("「中」以上のリスクが検出されている");
      if (r.findings.length !== 1) problems.push(`リスクが ${r.findings.length} 件(想定は 1 件)`);
      if (r.stats.formulaCount < 100) problems.push(`数式が ${r.stats.formulaCount} 個(100 個以上の想定)`);
      return problems;
    },
  },
};
