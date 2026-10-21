// 受注管理.xlsm: 営業事務が使う受注入力・請求書発行のブック。
// 仕込んだ問題: フォームから Access の受注DBへ直接書き込む(エラー処理なし)、共有フォルダ・個人のデスクトップのパスの直書き、
// Option Explicit のないモジュール、使われていない古いプロシージャ、設定シートの保存先を無視するコード。
import type { SampleDefinition } from "../lib/types";
import { formula, rowLabels, sharedColumn } from "../lib/workbook";
import { documentModule, vba } from "../lib/vba";

const THIS_WORKBOOK = vba`
Option Explicit

Private Sub Workbook_BeforeClose(Cancel As Boolean)
    ' 閉じる前に必ずバックアップを取る(2017/6 山田)
    ThisWorkbook.SaveCopyAs "D:\バックアップ\受注管理\受注管理_" & Format(Now, "yyyymmdd_hhnn") & ".xlsm"
End Sub
`;

const SHEET_ORDERS = vba`
Option Explicit

Private Sub Worksheet_BeforeDoubleClick(ByVal Target As Range, Cancel As Boolean)
    ' 受注番号の列をダブルクリックしたら修正画面を開く
    If Target.Column <> 1 Or Target.Row < 5 Then Exit Sub
    If Target.Value = "" Then Exit Sub
    Cancel = True
    frm受注入力.修正モードで開く Target.Row
End Sub
`;

const FORM = vba`
Option Explicit

Private 修正行 As Long

Private Sub UserForm_Initialize()
    Dim ws As Worksheet
    Dim i As Long
    Set ws = Worksheets("顧客マスタ")
    ' 顧客コンボボックスに顧客マスタを読み込む
    For i = 2 To ws.Cells(Rows.Count, 1).End(xlUp).Row
        cmb顧客.AddItem ws.Cells(i, 1).Value & " " & ws.Cells(i, 2).Value
    Next i
    txt受注日.Value = Format(Date, "yyyy/mm/dd")
    修正行 = 0
End Sub

Public Sub 修正モードで開く(ByVal 行 As Long)
    修正行 = 行
    With Worksheets("受注一覧")
        txt受注日.Value = .Cells(行, 2).Value
        cmb顧客.Value = .Cells(行, 3).Value
        txt商品コード.Value = .Cells(行, 4).Value
        txt数量.Value = .Cells(行, 6).Value
    End With
    Me.Caption = "受注の修正"
    Me.Show
End Sub

Private Sub cmd登録_Click()
    If cmb顧客.Value = "" Or txt商品コード.Value = "" Then
        MsgBox "顧客と商品コードは必須です", vbExclamation
        Exit Sub
    End If
    If Not IsNumeric(txt数量.Value) Then
        MsgBox "数量は数字で入力してください", vbExclamation
        Exit Sub
    End If
    受注登録 Left(cmb顧客.Value, 5), txt商品コード.Value, CLng(txt数量.Value), CDate(txt受注日.Value), 修正行
    Unload Me
End Sub

Private Sub cmdキャンセル_Click()
    Unload Me
End Sub
`;

const MOD_ORDER = vba`
Option Explicit

' 受注管理 メイン処理
' 作成: 2014/04 山田  最終修正: 2022/03 佐藤(消費税の端数処理を変更)

Public Sub 受注入力画面を開く()
    frm受注入力.Show
End Sub

Public Sub 受注登録(ByVal 顧客コード As String, ByVal 商品コード As String, ByVal 数量 As Long, _
                    ByVal 受注日 As Date, Optional ByVal 修正行 As Long = 0)
    Dim ws As Worksheet
    Dim 行 As Long
    Dim 受注番号 As String
    Set ws = Worksheets("受注一覧")
    If 修正行 > 0 Then
        行 = 修正行
        受注番号 = ws.Cells(行, 1).Value
    Else
        行 = ws.Cells(Rows.Count, 1).End(xlUp).Row + 1
        受注番号 = 受注番号を採番()
    End If
    ws.Cells(行, 1).Value = 受注番号
    ws.Cells(行, 2).Value = 受注日
    ws.Cells(行, 3).Value = 顧客コード
    ws.Cells(行, 4).Value = 商品コード
    ws.Cells(行, 6).Value = 数量
    ' 単価・金額は数式で計算される(E列・G列・H列)
    Call 受注をDBへ書き込み(受注番号, 受注日, 顧客コード, 商品コード, 数量, ws.Cells(行, 5).Value)
    MsgBox "受注番号 " & 受注番号 & " で登録しました", vbInformation
End Sub

Private Function 受注番号を採番() As String
    Dim 連番 As Long
    連番 = Range("最終受注番号").Value + 1
    Range("最終受注番号").Value = 連番
    受注番号を採番 = "J" & Format(Date, "yymm") & "-" & Format(連番, "0000")
End Function

Public Sub 月末締め()
    ' 今月分の受注を「締め済」にして、請求書をまとめて発行する
    Dim ws As Worksheet
    Dim i As Long
    Dim 件数 As Long
    Set ws = Worksheets("受注一覧")
    If MsgBox(Month(Date) & "月分を締めます。よろしいですか?", vbYesNo) = vbNo Then Exit Sub
    For i = 5 To ws.Cells(Rows.Count, 1).End(xlUp).Row
        If ws.Cells(i, 9).Value = "" And Month(ws.Cells(i, 2).Value) = Month(Date) Then
            ws.Cells(i, 9).Value = "締め済"
            件数 = 件数 + 1
        End If
    Next i
    Call 請求書一括発行
    MsgBox 件数 & " 件を締めました"
End Sub
`;

const MOD_DB = vba`
Option Explicit

' 受注データを Access の受注DBに書き込む
' ※DBの場所を変えたらここを直すこと
Private Const DB_PATH As String = "\\fileserver01\営業部\受注管理\受注DB.accdb"

Public Sub 受注をDBへ書き込み(ByVal 受注番号 As String, ByVal 受注日 As Date, ByVal 顧客コード As String, _
                              ByVal 商品コード As String, ByVal 数量 As Long, ByVal 単価 As Currency)
    Dim cn As Object
    Dim sql As String
    Set cn = CreateObject("ADODB.Connection")
    cn.Open "Provider=Microsoft.ACE.OLEDB.12.0;Data Source=" & DB_PATH & ";"
    ' 修正のときは一度消してから入れ直す
    cn.Execute "DELETE FROM T_受注 WHERE 受注番号 = '" & 受注番号 & "'"
    sql = "INSERT INTO T_受注 (受注番号, 受注日, 顧客コード, 商品コード, 数量, 単価, 登録者) VALUES ('" & _
          受注番号 & "', #" & Format(受注日, "yyyy/mm/dd") & "#, '" & 顧客コード & "', '" & 商品コード & "', " & _
          数量 & ", " & 単価 & ", '" & Application.UserName & "')"
    cn.Execute sql
    cn.Close
    Set cn = Nothing
End Sub

' 顧客マスタのD列(未請求額)から呼ばれるワークシート関数
Public Function 顧客の未請求額(ByVal 顧客コード As String) As Currency
    Dim cn As Object
    Dim rs As Object
    Set cn = CreateObject("ADODB.Connection")
    cn.Open "Provider=Microsoft.ACE.OLEDB.12.0;Data Source=" & DB_PATH & ";"
    Set rs = cn.Execute("SELECT SUM(数量 * 単価) FROM T_受注 WHERE 顧客コード = '" & 顧客コード & "' AND 請求済 = False")
    If Not IsNull(rs.Fields(0).Value) Then 顧客の未請求額 = rs.Fields(0).Value
    rs.Close
    cn.Close
End Function
`;

const MOD_INVOICE = vba`
' 請求書の発行
' 請求書シート(非表示)をコピーして、顧客ごとにPDFで保存し、2部印刷する

Sub 請求書発行()
    ' 受注一覧で選択している行の顧客の請求書を発行する
    Dim 行
    行 = ActiveCell.Row
    If ActiveSheet.Name <> "受注一覧" Or 行 < 5 Then
        MsgBox "受注一覧で請求書を発行する行を選んでください"
        Exit Sub
    End If
    請求書を作成 Worksheets("受注一覧").Cells(行, 3).Value
End Sub

Sub 請求書一括発行()
    Dim ws, 顧客, 済み
    Set ws = Worksheets("受注一覧")
    Set 済み = CreateObject("Scripting.Dictionary")
    For i = 5 To ws.Cells(Rows.Count, 1).End(xlUp).Row
        顧客 = ws.Cells(i, 3).Value
        If ws.Cells(i, 9).Value = "締め済" And Not 済み.Exists(顧客) Then
            請求書を作成 顧客
            済み.Add 顧客, True
        End If
    Next
End Sub

Private Sub 請求書を作成(顧客コード)
    Dim 保存先
    ' 保存先は設定シートにもあるが、こちらが使われている
    保存先 = "C:\Users\yamada\Desktop\請求書\" & Format(Date, "yyyymm") & "\"
    If Dir(保存先, vbDirectory) = "" Then MkDir 保存先
    Worksheets("請求書").Visible = True
    Worksheets("請求書").Copy After:=Worksheets(Worksheets.Count)
    Worksheets("請求書").Visible = False
    With ActiveSheet
        .Name = "請求書_" & 顧客コード
        .Range("B4").Value = 顧客コード
        .Range("H3").Value = Date
        ' 明細の転記(最大15行まで)
        n = 0
        For i = 5 To Worksheets("受注一覧").Cells(Rows.Count, 1).End(xlUp).Row
            If Worksheets("受注一覧").Cells(i, 3).Value = 顧客コード And Worksheets("受注一覧").Cells(i, 9).Value = "締め済" Then
                .Cells(12 + n, 2).Value = Worksheets("受注一覧").Cells(i, 4).Value
                .Cells(12 + n, 5).Value = Worksheets("受注一覧").Cells(i, 6).Value
                .Cells(12 + n, 6).Value = Worksheets("受注一覧").Cells(i, 5).Value
                n = n + 1
            End If
        Next
        .ExportAsFixedFormat Type:=xlTypePDF, Filename:=保存先 & "請求書_" & 顧客コード & ".pdf"
        .PrintOut Copies:=2
    End With
    Application.DisplayAlerts = False
    ActiveSheet.Delete
    Application.DisplayAlerts = True
End Sub

Private Sub 旧_請求書発行()
    ' 2019年まで使っていた版。念のため残しておく(山田)
    Worksheets("請求書").PrintOut
End Sub
`;

export const JUCHU: SampleDefinition = {
  file: "受注管理.xlsm",
  title: "受注管理(受注入力・請求書発行)",
  description:
    "営業事務が受注を入力し、月末に請求書を発行するためのブックです。入力画面から共有フォルダの Access データベースへ直接書き込み、請求書はPDFで保存して印刷します。",
  highlights: [
    "入力画面(フォーム)から共有フォルダの Access の受注データベースに直接書き込んでいるのに、エラー処理がない(つながらないと途中で止まる)",
    "共有フォルダと担当者個人のデスクトップのパスがコードに直接書かれている(PCの入れ替えや異動で動かなくなる)",
    "メニューのボタン・受注一覧のダブルクリック・入力画面のボタンなど、起動のきっかけが画面のあちこちにある",
    "変数の宣言を強制しない(Option Explicit のない)モジュールと、どこからも呼ばれていない古い請求書発行の処理が残っている",
  ],
  workbook: {
    properties: {
      title: "受注管理",
      creator: "山田太郎",
      lastModifiedBy: "佐藤花子",
      created: "2014-04-01T09:12:00Z",
      modified: "2022-03-28T17:45:00Z",
      company: "株式会社サンプル精工",
    },
    sheets: [
      {
        name: "メニュー",
        codeName: "Sheet1",
        columnWidths: { 1: 3, 2: 40 },
        cells: [
          { ref: "B2", value: "受注管理システム" },
          { ref: "B3", value: "(ボタンを押して操作してください)" },
          { ref: "B16", value: "※月末締めは経理に確認してから押すこと" },
        ],
        buttons: [
          { kind: "form", text: "受注入力", macro: "受注入力画面を開く", col: 1, row: 4, cols: 2, rows: 2 },
          { kind: "shape", text: "請求書発行", macro: "請求書発行", col: 1, row: 8, cols: 2, rows: 2 },
          { kind: "form", text: "月末締め", macro: "月末締め", col: 1, row: 12, cols: 2, rows: 2 },
        ],
      },
      {
        name: "受注一覧",
        codeName: "Sheet2",
        cells: [
          { ref: "A2", value: "受注一覧" },
          ...rowLabels("A4", ["受注番号", "受注日", "顧客コード", "商品コード", "単価", "数量", "金額", "税込金額", "締め"]),
          ...rowLabels("A5", ["J2403-0126", "2024/03/04", "C0012", "P-1001"]),
          { ref: "F5", value: 20 },
          ...rowLabels("A6", ["J2403-0127", "2024/03/05", "C0031", "P-2040"]),
          { ref: "F6", value: 5 },
          ...rowLabels("A7", ["J2403-0128", "2024/03/05", "C0012", "P-1003"]),
          { ref: "F7", value: 12 },
          sharedColumn("E", 5, 24, 'IFERROR(VLOOKUP(D5,商品マスタ!$A:$C,3,FALSE),"")'),
          sharedColumn("G", 5, 24, 'IF(E5="","",E5*F5)'),
          sharedColumn("H", 5, 24, 'IF(G5="","",ROUNDDOWN(G5*(1+消費税率),0))'),
        ],
      },
      {
        name: "顧客マスタ",
        codeName: "Sheet3",
        cells: [
          ...rowLabels("A1", ["顧客コード", "顧客名", "締日", "未請求額"]),
          ...rowLabels("A2", ["C0012", "サンプル電機株式会社", "末日"]),
          ...rowLabels("A3", ["C0031", "テスト工業株式会社", "20日"]),
          ...rowLabels("A4", ["C0045", "架空商事株式会社", "末日"]),
          sharedColumn("D", 2, 16, "顧客の未請求額(A2)"),
        ],
      },
      {
        name: "商品マスタ",
        codeName: "Sheet4",
        cells: [
          ...rowLabels("A1", ["商品コード", "商品名", "単価"]),
          ...rowLabels("A2", ["P-1001", "精密シャフト φ10", 1200]),
          ...rowLabels("A3", ["P-1003", "精密シャフト φ12", 1450]),
          ...rowLabels("A4", ["P-2040", "アルミブラケット(小)", 680]),
        ],
      },
      {
        name: "請求書",
        codeName: "Sheet5",
        state: "hidden",
        cells: [
          { ref: "B2", value: "御請求書" },
          { ref: "G3", value: "発行日" },
          formula("B5", 'IFERROR(VLOOKUP(B4,顧客マスタ!$A:$B,2,FALSE),"")'),
          { ref: "B8", value: "ご請求金額" },
          formula("C8", "G29"),
          ...rowLabels("B11", ["商品コード", "", "", "数量", "単価", "金額"]),
          sharedColumn("G", 12, 26, 'IF(E12="","",E12*F12)'),
          { ref: "F27", value: "小計" },
          formula("G27", "SUM(G12:G26)"),
          { ref: "F28", value: "消費税" },
          formula("G28", "ROUNDDOWN(G27*消費税率,0)"),
          { ref: "F29", value: "合計" },
          formula("G29", "G27+G28"),
        ],
      },
      {
        name: "設定",
        codeName: "Sheet6",
        state: "hidden",
        cells: [
          ...rowLabels("A2", ["最終受注番号", 128]),
          ...rowLabels("A3", ["消費税率", 0.1]),
          ...rowLabels("A4", ["請求書保存先", "\\\\fileserver01\\営業部\\請求書\\"]),
        ],
      },
    ],
    definedNames: [
      { name: "_xlnm.Print_Area", localSheetId: 4, refersTo: "請求書!$A$1:$H$32" },
      { name: "最終受注番号", refersTo: "設定!$B$2" },
      { name: "消費税率", refersTo: "設定!$B$3" },
    ],
    vba: {
      modules: [
        { name: "ThisWorkbook", type: "document", code: THIS_WORKBOOK },
        documentModule("Sheet1"),
        documentModule("Sheet2", SHEET_ORDERS),
        documentModule("Sheet3"),
        documentModule("Sheet4"),
        documentModule("Sheet5"),
        documentModule("Sheet6"),
        { name: "frm受注入力", type: "form", code: FORM },
        { name: "mod受注", type: "standard", code: MOD_ORDER },
        { name: "modDB", type: "standard", code: MOD_DB },
        { name: "mod請求書", type: "standard", code: MOD_INVOICE },
      ],
    },
  },
  expect: {
    findings: ["HARDCODED-PATH", "NO-ERROR-HANDLING", "NO-OPTION-EXPLICIT", "UNUSED-PRIVATE"],
    absentFindings: ["CRED-HARDCODED", "VBA-API-64BIT", "SENDKEYS", "SHELL", "VBA-LOCKED", "LONG-PROCEDURE", "EXTERNAL-LINK"],
    entryKinds: ["button", "event"],
    dependencyKinds: ["connectionString", "sql", "filePath", "createObject", "fileIo", "print"],
    complexity: "中",
    checks: (r) => {
      const problems: string[] = [];
      const noHandling = r.findings.find((f) => f.ruleId === "NO-ERROR-HANDLING");
      if (!noHandling?.locations.some((l) => l.module === "modDB" && l.procedure === "受注をDBへ書き込み")) {
        problems.push("DB への書き込み(modDB.受注をDBへ書き込み)がエラー処理なしとして検出されていない");
      }
      const unused = r.findings.find((f) => f.ruleId === "UNUSED-PRIVATE");
      if (!unused?.locations.some((l) => l.procedure === "旧_請求書発行")) problems.push("旧_請求書発行 が未使用として検出されていない");
      const paths = r.dependencies.filter((d) => d.kind === "filePath").map((d) => d.target);
      for (const p of ["\\\\fileserver01\\営業部\\受注管理\\受注DB.accdb", "C:\\Users\\yamada\\Desktop\\請求書\\"]) {
        if (!paths.includes(p)) problems.push(`ハードコードされたパス ${p} が検出されていない`);
      }
      const buttons = r.entryPoints.filter((e) => e.kind === "button");
      if (buttons.length !== 3 || buttons.some((b) => !b.procedure)) problems.push("メニューの3つのボタンがプロシージャに結び付いていない");
      if (!r.entryPoints.some((e) => e.procedure === "Sheet2.Worksheet_BeforeDoubleClick")) problems.push("受注一覧のダブルクリックが起動のきっかけにない");
      if (!r.callGraph.some((e) => e.from === "Sheet2.Worksheet_BeforeDoubleClick" && e.to === "frm受注入力.修正モードで開く")) {
        problems.push("ダブルクリック → 修正画面の呼び出しが検出されていない");
      }
      return problems;
    },
  },
};
