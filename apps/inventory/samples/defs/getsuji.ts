// 月次売上集計.xlsm: 経理が毎月、各営業所の売上ブックを開いて集計し、販売管理システムへ取り込み、報告メールを送るブック。
// 仕込んだ問題: 営業所ごとにコピーして増やした 200 行超のプロシージャ、On Error Resume Next、SendKeys による画面操作、
// Shell での外部プログラム起動、他ブックへの数式リンク(年度でファイル名が変わる予算ブックと個人フォルダの前年実績)、
// 共有フォルダ・個人フォルダのパスの直書き、#REF! の残った数式と名前定義、Option Explicit のないモジュール。
import type { SampleDefinition } from "../lib/types";
import { formula, rowLabels, sharedColumn, type CellSpec } from "../lib/workbook";
import { documentModule, vba } from "../lib/vba";

interface Branch {
  name: string;
  sheet: string;
  /** 集計シートで使う行 */
  row: number;
  /** データの開始行 */
  firstRow: number;
  /** 返品金額の列 */
  returnCol: number;
  note?: string;
}

const BRANCHES: Branch[] = [
  { name: "東京営業所", sheet: "東京", row: 6, firstRow: 5, returnCol: 7 },
  { name: "大阪営業所", sheet: "大阪", row: 7, firstRow: 6, returnCol: 7, note: "    ' 大阪だけ見出しが2行あるので6行目から読む" },
  { name: "名古屋営業所", sheet: "名古屋", row: 8, firstRow: 5, returnCol: 8, note: "    ' 名古屋は2023年に2課と統合してから返品の列が1つ右にずれている(H列)" },
];

/** 営業所ごとの処理(実際のマクロと同じく、コピーして少しずつ書き換えた形) */
function branchBlock(b: Branch): string {
  const lines = [
    `    '==================== ${b.name} ====================`,
    `    Set wb = Workbooks.Open(元フォルダ & "${b.name}_売上.xlsx", UpdateLinks:=0)`,
    `    ' 「リンクの更新」の確認が出ることがあるので Enter を送っておく`,
    `    SendKeys "{ENTER}"`,
    `    Set ws = ThisWorkbook.Worksheets("${b.sheet}")`,
    `    ws.Range("A5:H1000").ClearContents`,
    `    最終行 = 最終行を取得(wb.Worksheets(1), 1)`,
    `    出力行 = 5`,
    `    合計 = 0`,
    `    件数 = 0`,
    ...(b.note ? [b.note] : []),
    `    For 行 = ${b.firstRow} To 最終行`,
    `        If wb.Worksheets(1).Cells(行, 1).Value <> "" Then`,
    `            ws.Cells(出力行, 1).Value = wb.Worksheets(1).Cells(行, 1).Value   ' 売上日`,
    `            ws.Cells(出力行, 2).Value = wb.Worksheets(1).Cells(行, 2).Value   ' 得意先コード`,
    `            ws.Cells(出力行, 3).Value = wb.Worksheets(1).Cells(行, 3).Value   ' 得意先名`,
    `            ws.Cells(出力行, 4).Value = wb.Worksheets(1).Cells(行, 4).Value   ' 品目区分`,
    `            ws.Cells(出力行, 5).Value = wb.Worksheets(1).Cells(行, 5).Value   ' 数量`,
    `            ws.Cells(出力行, 6).Value = wb.Worksheets(1).Cells(行, 6).Value   ' 売上金額`,
    `            ws.Cells(出力行, 7).Value = wb.Worksheets(1).Cells(行, ${b.returnCol}).Value   ' 返品金額`,
    `            ' 返品は差し引いて計上する`,
    `            ws.Cells(出力行, 8).Value = ws.Cells(出力行, 6).Value - ws.Cells(出力行, 7).Value`,
    `            合計 = 合計 + ws.Cells(出力行, 8).Value`,
    `            件数 = 件数 + 1`,
    `            出力行 = 出力行 + 1`,
    `        End If`,
    `    Next 行`,
    `    wb.Close SaveChanges:=False`,
    ``,
    `    ' 品目区分ごとの小計`,
    `    製品計 = 0: 部品計 = 0: 修理計 = 0`,
    `    For 行 = 5 To 出力行 - 1`,
    `        Select Case ws.Cells(行, 4).Value`,
    `            Case "製品"`,
    `                製品計 = 製品計 + ws.Cells(行, 8).Value`,
    `            Case "部品"`,
    `                部品計 = 部品計 + ws.Cells(行, 8).Value`,
    `            Case "修理", "保守"`,
    `                修理計 = 修理計 + ws.Cells(行, 8).Value`,
    `            Case Else`,
    `                ' 区分なしは製品に入れる(2018/10 部長指示)`,
    `                製品計 = 製品計 + ws.Cells(行, 8).Value`,
    `        End Select`,
    `    Next 行`,
    `    With ThisWorkbook.Worksheets("集計")`,
    `        .Range("C${b.row}").Value = 製品計`,
    `        .Range("D${b.row}").Value = 部品計`,
    `        .Range("E${b.row}").Value = 修理計`,
    `        .Range("F${b.row}").Value = 合計`,
    `        .Range("G${b.row}").Value = 件数`,
    `    End With`,
    ``,
    `    ' 前月より30%以上増減していたら色を付けて知らせる`,
    `    前月 = ThisWorkbook.Worksheets("作業用").Range("C${b.row}").Value`,
    `    If 前月 <> 0 Then`,
    `        変化率 = 合計 / 前月 - 1`,
    `        If Abs(変化率) >= 0.3 Then`,
    `            ThisWorkbook.Worksheets("集計").Range("F${b.row}").Interior.Color = RGB(255, 199, 206)`,
    `        Else`,
    `            ThisWorkbook.Worksheets("集計").Range("F${b.row}").Interior.ColorIndex = xlNone`,
    `        End If`,
    `    End If`,
    `    ThisWorkbook.Worksheets("作業用").Range("C${b.row}").Value = 合計`,
    `    If 件数 = 0 Then`,
    `        MsgBox "${b.name}のデータがありません。ファイルを確認してください。"`,
    `    End If`,
    ``,
  ];
  return lines.join("\n");
}

const MOD_MONTHLY = [
  vba`
' 月次売上集計マクロ
' 毎月5営業日目に実行する。各営業所から共有フォルダに届いた売上ブックを開いて集計する
' 作成: 2016/05 田中  ※営業所が増えたら、下のブロックをコピーして追加すること

Sub 月次集計メイン()
    Dim 対象月 As String
    Dim 元フォルダ As String
    Dim wb As Workbook
    Dim ws As Worksheet
    Dim 行 As Long, 最終行 As Long, 出力行 As Long
    Dim 合計 As Currency, 件数 As Long

    対象月 = InputBox("集計する月を入力してください(例: 202403)", "月次集計", Format(DateAdd("m", -1, Date), "yyyymm"))
    If 対象月 = "" Then Exit Sub
    元フォルダ = "\\fileserver01\営業部\月次報告\" & 対象月 & "\"

    Application.ScreenUpdating = False
    Application.DisplayAlerts = False
    ' 途中でエラーが出ても最後まで流す(2019/2 追加)
    On Error Resume Next
`,
  ...BRANCHES.map(branchBlock),
  vba`
    '==================== 全社合計 ====================
    With ThisWorkbook.Worksheets("集計")
        .Range("C2").Value = Left(対象月, 4) & "年" & Mid(対象月, 5, 2) & "月"
        .Range("C9").Value = .Range("C6").Value + .Range("C7").Value + .Range("C8").Value
        .Range("D9").Value = .Range("D6").Value + .Range("D7").Value + .Range("D8").Value
        .Range("E9").Value = .Range("E6").Value + .Range("E7").Value + .Range("E8").Value
        .Range("F9").Value = .Range("F6").Value + .Range("F7").Value + .Range("F8").Value
        .Range("G9").Value = .Range("G6").Value + .Range("G7").Value + .Range("G8").Value
        .Range("B12").Value = "最終集計: " & Format(Now, "yyyy/mm/dd hh:nn") & " " & Application.UserName
    End With

    ' 予算・前年実績のリンクを更新する
    Call 予算対比を更新

    ' 作業用シートに履歴を残す
    With ThisWorkbook.Worksheets("作業用")
        .Cells(.Rows.Count, 1).End(xlUp).Offset(1, 0).Value = 対象月
        .Cells(.Rows.Count, 1).End(xlUp).Offset(0, 1).Value = ThisWorkbook.Worksheets("集計").Range("F9").Value
    End With

    Application.DisplayAlerts = True
    Application.ScreenUpdating = True
    ThisWorkbook.Save
    MsgBox 対象月 & " の集計が終わりました。", vbInformation
End Sub
`,
].join("\n");

const MOD_OUTPUT = vba`
Option Explicit

Private Const 取込フォルダ As String = "D:\HANBAI\IMPORT\"

' 販売管理システムに取り込むCSVを作り、取込メニューを自動で操作する
Public Sub 基幹システム用CSV出力()
    Dim ws As Worksheet
    Dim f As Integer
    Dim i As Long
    Dim ファイル名 As String
    Set ws = Worksheets("集計")
    ファイル名 = 取込フォルダ & "uriage_" & Format(Date, "yyyymm") & ".csv"
    f = FreeFile
    Open ファイル名 For Output As #f
    For i = 6 To 8
        Print #f, ws.Cells(i, 2).Value & "," & ws.Cells(i, 6).Value & "," & ws.Cells(i, 7).Value
    Next i
    Close #f

    ' 販売管理システムを起動して、メニューの「ファイル」→「取込」をキー操作で選ぶ
    Shell "C:\HANBAI\HanbaiMenu.exe", vbNormalFocus
    Application.Wait Now + TimeValue("00:00:05")
    AppActivate "販売管理システム"
    SendKeys "%F", True
    SendKeys "I", True
    Application.Wait Now + TimeValue("00:00:02")
    SendKeys ファイル名 & "{ENTER}", True
End Sub

' 経営会議用の報告メールを送る(Outlook)
Public Sub 報告メール送信()
    Dim ol As Object
    Dim mail As Object
    Set ol = CreateObject("Outlook.Application")
    Set mail = ol.CreateItem(0)
    With mail
        .To = "keiei@example.co.jp"
        .CC = "eigyo-bucho@example.co.jp"
        .Subject = "【月次売上】" & Worksheets("集計").Range("C2").Value & " 集計結果"
        .Body = "お疲れ様です。" & vbCrLf & "今月の売上集計を添付します。" & vbCrLf & vbCrLf & "経理 田中"
        .Attachments.Add ThisWorkbook.FullName
        .Send
    End With
End Sub
`;

const MOD_BUDGET = vba`
Option Explicit

' 予算対比シートのリンク(予算ブック・前年実績ブック)を最新にする
' ※年度が変わったら、予算ブックのファイル名をここと数式の両方で書き換えること
Public Sub 予算対比を更新()
    ThisWorkbook.UpdateLink Name:="\\fileserver01\経営企画\予算\2024年度予算.xlsx", Type:=xlExcelLinks
    ThisWorkbook.UpdateLink Name:="C:\Users\tanaka\Documents\月次\前年実績.xlsx", Type:=xlExcelLinks
    Worksheets("予算対比").Calculate
End Sub
`;

const MOD_COMMON = vba`
' 共通関数

Public Function 最終行を取得(ByVal ws As Worksheet, Optional ByVal 列 As Long = 1) As Long
    最終行を取得 = ws.Cells(ws.Rows.Count, 列).End(xlUp).Row
End Function

Public Function 営業日を数える(ByVal 開始日 As Date, ByVal 終了日 As Date) As Long
    ' 土日だけ除く(祝日は見ていない)
    Dim d As Date
    For d = 開始日 To 終了日
        If Weekday(d, vbMonday) <= 5 Then 営業日を数える = 営業日を数える + 1
    Next d
End Function
`;

const branchSheet = (name: string, codeName: string): { name: string; codeName: string; cells: CellSpec[] } => ({
  name,
  codeName,
  cells: [
    { ref: "A2", value: `${name}営業所 売上明細(マクロで上書きされます)` },
    { ref: "G2", value: "合計" },
    formula("H2", "SUM(H5:H1000)"),
    ...rowLabels("A4", ["売上日", "得意先コード", "得意先名", "品目区分", "数量", "売上金額", "返品金額", "純売上"]),
  ],
});

export const GETSUJI: SampleDefinition = {
  file: "月次売上集計.xlsm",
  title: "月次売上集計(営業所別の集計・報告)",
  description:
    "経理担当が毎月、各営業所から届く売上ブックを開いて集計し、販売管理システムへの取込と経営会議向けの報告メールまでを行うブックです。予算ブック・前年実績ブックを数式で参照しています。",
  highlights: [
    "営業所ごとにコピーして増やした 200 行を超える集計処理(営業所が増えるたびに改修が必要)",
    "On Error Resume Next でエラーを無視するため、ファイルが届いていなくても集計が「完了」してしまう",
    "販売管理システムをキー操作の自動送信(SendKeys)で動かしており、画面やタイミングが変わると誤動作する",
    "予算ブック(年度でファイル名が変わる)と担当者個人のフォルダにある前年実績ブックへの数式リンク",
    "削除した課の名残の #REF! が数式と名前定義に残っている",
  ],
  workbook: {
    properties: {
      title: "月次売上集計",
      creator: "田中一郎",
      lastModifiedBy: "田中一郎",
      created: "2016-05-10T10:03:00Z",
      modified: "2024-04-08T19:20:00Z",
      company: "株式会社サンプル精工",
    },
    sheets: [
      {
        name: "集計",
        codeName: "Sheet1",
        columnWidths: { 2: 16 },
        cells: [
          { ref: "B2", value: "対象月" },
          ...rowLabels("B5", ["営業所", "製品", "部品", "修理・保守", "合計", "件数", "構成比", "予算達成率"]),
          { ref: "B6", value: "東京" },
          { ref: "B7", value: "大阪" },
          { ref: "B8", value: "名古屋" },
          { ref: "B9", value: "全社" },
          sharedColumn("H", 6, 8, "IF($F$9=0,0,F6/$F$9)"),
          formula("H9", "SUM(H6:H8)"),
          sharedColumn("I", 6, 9, 'IFERROR(F6/予算対比!B6,"-")'),
          { ref: "B20", value: "名古屋2課(2023年に統合)" },
          formula("F20", "SUM(#REF!)"),
        ],
        buttons: [
          { kind: "form", text: "月次集計を実行", macro: "月次集計メイン", col: 10, row: 4, cols: 2, rows: 2 },
          { kind: "form", text: "販売管理へ取込", macro: "基幹システム用CSV出力", col: 10, row: 7, cols: 2, rows: 2 },
          { kind: "shape", text: "報告メールを送る", macro: "報告メール送信", col: 10, row: 10, cols: 2, rows: 2 },
        ],
      },
      branchSheet("東京", "Sheet2"),
      branchSheet("大阪", "Sheet3"),
      branchSheet("名古屋", "Sheet4"),
      {
        name: "予算対比",
        codeName: "Sheet5",
        cells: [
          ...rowLabels("A5", ["営業所", "予算", "実績", "達成率", "前年実績", "前年比"]),
          { ref: "A6", value: "東京" },
          { ref: "A7", value: "大阪" },
          { ref: "A8", value: "名古屋" },
          { ref: "A9", value: "全社" },
          sharedColumn("B", 6, 8, "[1]予算!$C5"),
          sharedColumn("C", 6, 8, "集計!F6"),
          sharedColumn("D", 6, 9, 'IF(B6=0,"-",C6/B6)'),
          sharedColumn("E", 6, 8, "[2]前年!F6"),
          sharedColumn("F", 6, 9, 'IF(E6=0,"-",C6/E6)'),
          formula("B9", "SUM(B6:B8)"),
          formula("C9", "SUM(C6:C8)"),
          formula("E9", "SUM(E6:E8)"),
          { ref: "A11", value: "月別予算" },
          { ref: "B12", formula: "[1]予算!D10", sharedRange: "B12:M12" },
        ],
      },
      {
        name: "作業用",
        codeName: "Sheet6",
        state: "hidden",
        cells: [...rowLabels("A1", ["対象月", "全社合計", "前月(営業所別)"])],
      },
    ],
    definedNames: [
      { name: "集計範囲", refersTo: "集計!$B$5:$G$9" },
      { name: "旧名古屋2課", refersTo: "#REF!$A$5:$H$500" },
    ],
    externalLinks: [
      { path: "\\\\fileserver01\\経営企画\\予算\\2024年度予算.xlsx", sheetNames: ["予算"] },
      { path: "C:\\Users\\tanaka\\Documents\\月次\\前年実績.xlsx", sheetNames: ["前年"] },
    ],
    vba: {
      modules: [
        documentModule("ThisWorkbook"),
        documentModule("Sheet1"),
        documentModule("Sheet2"),
        documentModule("Sheet3"),
        documentModule("Sheet4"),
        documentModule("Sheet5"),
        documentModule("Sheet6"),
        { name: "mod月次集計", type: "standard", code: MOD_MONTHLY },
        { name: "mod出力", type: "standard", code: MOD_OUTPUT },
        { name: "mod予算対比", type: "standard", code: MOD_BUDGET },
        { name: "mod共通", type: "standard", code: MOD_COMMON },
      ],
    },
  },
  expect: {
    findings: [
      "SENDKEYS",
      "SHELL",
      "HARDCODED-PATH",
      "RESUME-NEXT",
      "LONG-PROCEDURE",
      "EXTERNAL-LINK",
      "NO-ERROR-HANDLING",
      "NO-OPTION-EXPLICIT",
      "BROKEN-REF",
    ],
    absentFindings: ["CRED-HARDCODED", "VBA-API-64BIT", "IE-AUTOMATION", "VBA-LOCKED", "DATA-CONNECTION"],
    entryKinds: ["button"],
    dependencyKinds: ["workbook", "externalLink", "sendKeys", "shell", "createObject", "fileIo", "filePath"],
    complexity: "中",
    checks: (r) => {
      const problems: string[] = [];
      const long = r.vba?.modules.find((m) => m.name === "mod月次集計")?.procedures.find((p) => p.name === "月次集計メイン");
      if (!long || long.lineCount <= 200) problems.push(`月次集計メイン が 200 行を超えていない(${long?.lineCount ?? "なし"} 行)`);
      if (!r.findings.find((f) => f.ruleId === "LONG-PROCEDURE")?.locations.some((l) => l.procedure === "月次集計メイン")) {
        problems.push("月次集計メイン が長いプロシージャとして検出されていない");
      }
      if (r.dependencies.filter((d) => d.kind === "workbook").length !== 3) problems.push("営業所ブックを開く処理(Workbooks.Open)が 3 か所検出されていない");
      if (!r.dependencies.some((d) => d.kind === "createObject" && d.category === "メール送信")) problems.push("Outlook でのメール送信が検出されていない");
      if (r.excel?.externalLinks.length !== 2) problems.push("外部リンクが 2 件になっていない");
      const brokenRef = r.findings.find((f) => f.ruleId === "BROKEN-REF");
      if (!brokenRef || brokenRef.count < 2) problems.push("#REF! が数式と名前定義の両方で検出されていない");
      const buttons = r.entryPoints.filter((e) => e.kind === "button");
      if (buttons.length !== 3 || buttons.some((b) => !b.procedure)) problems.push("集計シートの3つのボタンがプロシージャに結び付いていない");
      if (!r.callGraph.some((e) => e.from === "mod月次集計.月次集計メイン" && e.to === "mod予算対比.予算対比を更新")) {
        problems.push("月次集計メイン → 予算対比を更新 の呼び出しが検出されていない");
      }
      return problems;
    },
  },
};
