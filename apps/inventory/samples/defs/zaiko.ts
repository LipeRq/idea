// 在庫引当マクロ.xlsm: 倉庫で使う、在庫DB(SQL Server)から在庫を取り込んで受注残に引き当てるブック。
// 仕込んだ問題: ブックを開くと自動で動く(Workbook_Open)・30分ごとに自分を予約し直す OnTime(閉じても開き直す)、
// ショートカットキー(OnKey)、PtrSafe のない 32bit 用の Declare、接続文字列(2 か所にコピー)・コメント・シート保護・net use に書かれたパスワード
// (すべてダミー値。仕様書・JSON では伏せ字になることを確かめる)、データ接続(ODBC)、IE の自動操作、
// 完全に非表示のシート、表示用ロックのかかった VBA プロジェクト。
import type { SampleDefinition } from "../lib/types";
import { formula, rowLabels, sharedColumn } from "../lib/workbook";
import { documentModule, vba } from "../lib/vba";

/** 伏せ字になることを確かめるためのダミーのパスワード(実在のものではない) */
const DUMMY_SECRETS = ["Zaiko#2019!", "hogo-1234", "Soko@2020"];

const THIS_WORKBOOK = vba`
Option Explicit

Private Sub Workbook_Open()
    ' 倉庫のPCで開いたときだけ、共有フォルダにつないで自動取込を始める
    If Environ("COMPUTERNAME") Like "SOKO-PC*" Then
        Call 共有フォルダに接続
        Call 在庫取込
        Call 定時取込を予約
    End If
    ' Ctrl+Shift+Z で在庫照会の画面を開く
    Application.OnKey "^+Z", "在庫照会を開く"
    Worksheets("在庫一覧").Activate
End Sub
`;

const MOD_IMPORT = vba`
Option Explicit

' 在庫DB(SQL Server)から在庫を取り込み、受注残に引き当てる
' 作成: 2018/09 鈴木(システム担当)
' DBのパスワードは「Zaiko#2019!」(変えたらここと接続設定シートも直す)

Private Declare Sub Sleep Lib "kernel32" (ByVal dwMilliseconds As Long)
Private Declare Function GetUserName Lib "advapi32.dll" Alias "GetUserNameA" (ByVal lpBuffer As String, nSize As Long) As Long

Private Const 接続文字列 As String = "Provider=SQLOLEDB;Data Source=SV-ZAIKO01;Initial Catalog=在庫管理;User ID=zaiko_app;Password=Zaiko#2019!;"
Private Const 取込間隔 As String = "00:30:00"

Public 次回取込時刻 As Date

Public Sub 在庫取込()
    Dim cn As Object
    Dim rs As Object
    Dim ws As Worksheet
    Dim 試行 As Integer
    Set ws = Worksheets("在庫一覧")
    Set cn = CreateObject("ADODB.Connection")
    ' サーバーが混んでいるとつながらないので3回までやり直す
    On Error Resume Next
    For 試行 = 1 To 3
        cn.Open 接続文字列
        If cn.State = 1 Then Exit For
        Sleep 3000
    Next 試行
    On Error GoTo 0
    Set rs = cn.Execute("SELECT 品番, 品名, 倉庫コード, 在庫数, 引当済数 FROM dbo.T_在庫 WHERE 倉庫コード IN ('01', '02') ORDER BY 品番")
    ws.Unprotect "hogo-1234"
    ws.Range("A5:F5000").ClearContents
    ws.Range("A5").CopyFromRecordset rs
    ws.Range("B2").Value = Now
    ws.Range("D2").Value = 取込担当者()
    rs.Close
    cn.Close
    Call 受注残に引当
    ws.Protect "hogo-1234"
End Sub

Private Sub 受注残に引当()
    ' 受注残の古い順に、在庫がある分だけ引き当てる(先入先出)
    Dim ws在庫 As Worksheet, ws残 As Worksheet, ws結果 As Worksheet
    Dim i As Long, j As Long, 出力行 As Long
    Dim 必要数 As Long, 引当数 As Long
    Dim cn As Object
    Set ws在庫 = Worksheets("在庫一覧")
    Set ws残 = Worksheets("受注残")
    Set ws結果 = Worksheets("引当結果")
    ws結果.Range("A5:H5000").ClearContents
    出力行 = 5
    Set cn = CreateObject("ADODB.Connection")
    cn.Open 接続文字列
    For i = 5 To ws残.Cells(ws残.Rows.Count, 1).End(xlUp).Row
        必要数 = ws残.Cells(i, 5).Value - ws残.Cells(i, 6).Value
        If 必要数 > 0 Then
            For j = 5 To ws在庫.Cells(ws在庫.Rows.Count, 1).End(xlUp).Row
                If ws在庫.Cells(j, 1).Value = ws残.Cells(i, 3).Value Then
                    引当数 = Application.WorksheetFunction.Min(必要数, ws在庫.Cells(j, 4).Value - ws在庫.Cells(j, 5).Value)
                    If 引当数 > 0 Then
                        ws在庫.Cells(j, 5).Value = ws在庫.Cells(j, 5).Value + 引当数
                        ws結果.Cells(出力行, 1).Value = ws残.Cells(i, 1).Value
                        ws結果.Cells(出力行, 2).Value = ws残.Cells(i, 3).Value
                        ws結果.Cells(出力行, 3).Value = 引当数
                        ws結果.Cells(出力行, 4).Value = ws在庫.Cells(j, 3).Value
                        出力行 = 出力行 + 1
                        ' 引当結果をDBにも書き戻す
                        cn.Execute "UPDATE dbo.T_受注残 SET 引当数 = 引当数 + " & 引当数 & " WHERE 受注番号 = '" & ws残.Cells(i, 1).Value & "'"
                        必要数 = 必要数 - 引当数
                    End If
                End If
                If 必要数 <= 0 Then Exit For
            Next j
        End If
    Next i
    cn.Close
    ' 出荷担当が見る引当結果を共有フォルダにも置く
    ws結果.Copy
    ActiveWorkbook.SaveAs "Z:\出荷\引当結果_" & Format(Date, "yyyymmdd") & ".xlsx"
    ActiveWorkbook.Close False
End Sub

Public Sub 定時取込を予約()
    次回取込時刻 = Now + TimeValue(取込間隔)
    Application.OnTime 次回取込時刻, "定時取込"
    ' TODO: ブックを閉じても勝手に開き直すことがある。要調査(2020/11 鈴木)
End Sub

Public Sub 定時取込()
    Call 在庫取込
    Call 定時取込を予約
End Sub

Public Sub 共有フォルダに接続()
    ' 倉庫PCは共有フォルダに自動でつながらないので、起動時に net use する
    Shell "cmd /c net use Z: \\SV-FILE01\倉庫 /user:soko Soko@2020", vbHide
    Sleep 2000
End Sub

Private Function 取込担当者() As String
    Dim buf As String * 256
    Dim size As Long
    size = 256
    If GetUserName(buf, size) <> 0 Then
        取込担当者 = Left(buf, size - 1)
    Else
        取込担当者 = Environ("USERNAME")
    End If
End Function
`;

const MOD_TRACKING = vba`
Option Explicit

Private Declare Function FindWindow Lib "user32" Alias "FindWindowA" (ByVal lpClassName As String, ByVal lpWindowName As String) As Long

' 運送会社のサイトで出荷状況を調べて「出荷状況」シートに書く
' ※Internet Explorer でないと動かない(Edge では不可)
Public Sub 出荷状況を更新()
    Dim ie As Object
    Dim ws As Worksheet
    Dim i As Long
    Set ws = Worksheets("出荷状況")
    Set ie = CreateObject("InternetExplorer.Application")
    ie.Visible = False
    For i = 5 To ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
        ie.Navigate "https://tracking.example.com/search?no=" & ws.Cells(i, 2).Value
        Do While ie.Busy Or ie.ReadyState <> 4
            DoEvents
        Loop
        ws.Cells(i, 4).Value = ie.Document.getElementById("status").innerText
        ws.Cells(i, 5).Value = Now
    Next i
    ie.Quit
    Set ie = Nothing
End Sub
`;

const MOD_LOOKUP = vba`
Option Explicit

Public Sub 在庫照会を開く()
    frm在庫照会.Show vbModeless
End Sub
`;

const MOD_ORDER_POINT = vba`
Option Explicit

' 発注点を下回った品番を仕入先ごとにまとめ、発注依頼のメールを作る
' 発注点・仕入先・発注数は在庫一覧の右側(H列～J列)に手で入れている

Public Sub 発注点チェック()
    Dim ws As Worksheet
    Dim i As Long
    Dim 最終行 As Long
    Dim 仕入先 As String
    Dim 一覧 As Object
    Dim 本文 As String
    Dim キー As Variant
    Set ws = Worksheets("在庫一覧")
    Set 一覧 = CreateObject("Scripting.Dictionary")
    最終行 = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
    For i = 5 To 最終行
        If ws.Cells(i, 8).Value <> "" Then
            If ws.Cells(i, 4).Value - ws.Cells(i, 5).Value < ws.Cells(i, 8).Value Then
                仕入先 = ws.Cells(i, 9).Value
                If 仕入先 = "" Then 仕入先 = "(仕入先未登録)"
                If Not 一覧.Exists(仕入先) Then 一覧.Add 仕入先, ""
                一覧(仕入先) = 一覧(仕入先) & ws.Cells(i, 1).Value & vbTab & ws.Cells(i, 2).Value & vbTab & _
                    "発注数 " & ws.Cells(i, 10).Value & vbCrLf
            End If
        End If
    Next i
    If 一覧.Count = 0 Then
        MsgBox "発注点を下回った品番はありません", vbInformation
        Exit Sub
    End If
    For Each キー In 一覧.Keys
        本文 = キー & " 御中" & vbCrLf & vbCrLf & "いつもお世話になっております。" & vbCrLf & _
            "下記の品番の発注をお願いいたします。" & vbCrLf & vbCrLf & 一覧(キー) & vbCrLf & "株式会社サンプル精工 倉庫課"
        Call 発注メールを作成(CStr(キー), 本文)
    Next キー
End Sub

Private Sub 発注メールを作成(ByVal 仕入先 As String, ByVal 本文 As String)
    Dim ol As Object
    Dim mail As Object
    Set ol = CreateObject("Outlook.Application")
    Set mail = ol.CreateItem(0)
    mail.To = 仕入先のメールアドレス(仕入先)
    mail.Subject = "【発注依頼】" & Format(Date, "yyyy/mm/dd") & " 株式会社サンプル精工"
    mail.Body = 本文
    ' 送信前に倉庫課長が確認するので、下書きの表示まで
    mail.Display
End Sub

Private Function 仕入先のメールアドレス(ByVal 仕入先 As String) As String
    ' 仕入先のアドレスはここに直接書いている(仕入先マスタは無い)
    Select Case 仕入先
        Case "サンプル鋼材株式会社"
            仕入先のメールアドレス = "order@steel.example.jp"
        Case "テスト樹脂工業"
            仕入先のメールアドレス = "eigyo@jushi.example.jp"
        Case "架空ネジ製作所"
            仕入先のメールアドレス = "info@neji.example.jp"
        Case Else
            仕入先のメールアドレス = "soko-ka@example.co.jp"
    End Select
End Function
`;

const MOD_STOCKTAKE = vba`
Option Explicit

' 月末棚卸: ハンディターミナルで数えた結果(CSV)を取り込み、帳簿在庫との差異を出す
Private Const 棚卸フォルダ As String = "C:\HANDY\DATA\"

Public Sub 棚卸結果を取込()
    Dim f As Integer
    Dim 行データ As String
    Dim 項目() As String
    Dim ws As Worksheet
    Dim 出力行 As Long
    Dim ファイル名 As String
    Dim 退避先 As String
    ファイル名 = Dir(棚卸フォルダ & "TANA*.csv")
    If ファイル名 = "" Then
        MsgBox "棚卸データが見つかりません。ハンディをPCにつないでください。"
        Exit Sub
    End If
    Set ws = Worksheets("棚卸差異")
    ws.Range("A5:G5000").ClearContents
    出力行 = 5
    f = FreeFile
    Open 棚卸フォルダ & ファイル名 For Input As #f
    Do Until EOF(f)
        Line Input #f, 行データ
        項目 = Split(行データ, ",")
        If UBound(項目) >= 2 Then
            ws.Cells(出力行, 1).Value = 項目(0)            ' 品番
            ws.Cells(出力行, 2).Value = 項目(1)            ' 棚番
            ws.Cells(出力行, 3).Value = CLng(項目(2))      ' 実在庫
            ws.Cells(出力行, 4).Value = 帳簿在庫(項目(0))
            ws.Cells(出力行, 5).Value = ws.Cells(出力行, 3).Value - ws.Cells(出力行, 4).Value
            出力行 = 出力行 + 1
        End If
    Loop
    Close #f
    ' 取り込んだファイルは日付を付けて退避する
    退避先 = 棚卸フォルダ & "済\" & Format(Date, "yyyymmdd") & "_" & ファイル名
    FileCopy 棚卸フォルダ & ファイル名, 退避先
    Kill 棚卸フォルダ & ファイル名
    MsgBox 出力行 - 5 & " 件を取り込みました"
End Sub

Private Function 帳簿在庫(ByVal 品番 As String) As Long
    Dim r As Range
    Set r = Worksheets("在庫一覧").Range("A:A").Find(品番, LookAt:=xlWhole)
    If r Is Nothing Then
        帳簿在庫 = 0
    Else
        帳簿在庫 = r.Offset(0, 3).Value
    End If
End Function

Public Sub 棚卸差異をDBに反映()
    Dim cn As Object
    Dim ws As Worksheet
    Dim i As Long
    Dim 担当 As String
    If MsgBox("棚卸差異を在庫DBに反映します。元に戻せません。よろしいですか?", vbYesNo + vbExclamation) = vbNo Then Exit Sub
    Set ws = Worksheets("棚卸差異")
    担当 = Environ("USERNAME")
    Set cn = CreateObject("ADODB.Connection")
    ' mod在庫取込 の接続文字列は Private なので、ここにもコピーしている
    cn.Open "Provider=SQLOLEDB;Data Source=SV-ZAIKO01;Initial Catalog=在庫管理;User ID=zaiko_app;Password=Zaiko#2019!;"
    cn.BeginTrans
    For i = 5 To ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
        If ws.Cells(i, 5).Value <> 0 Then
            cn.Execute "UPDATE dbo.T_在庫 SET 在庫数 = " & ws.Cells(i, 3).Value & " WHERE 品番 = '" & ws.Cells(i, 1).Value & "'"
            cn.Execute "INSERT INTO dbo.T_棚卸履歴 (品番, 棚卸日, 帳簿数, 実数, 担当) VALUES ('" & ws.Cells(i, 1).Value & "', GETDATE(), " & _
                ws.Cells(i, 4).Value & ", " & ws.Cells(i, 3).Value & ", '" & 担当 & "')"
        End If
    Next i
    cn.CommitTrans
    cn.Close
    MsgBox "反映しました"
End Sub
`;

const MOD_PICKING = vba`
Option Explicit

' 引当結果から棚番順のピッキングリストを作って印刷する
Public Sub ピッキングリスト印刷()
    Dim ws結果 As Worksheet
    Dim wsリスト As Worksheet
    Dim i As Long
    Dim 行 As Long
    Dim 最終行 As Long
    Set ws結果 = Worksheets("引当結果")
    最終行 = ws結果.Cells(ws結果.Rows.Count, 1).End(xlUp).Row
    If 最終行 < 5 Then
        MsgBox "引当結果がありません"
        Exit Sub
    End If
    Application.ScreenUpdating = False
    Set wsリスト = Worksheets.Add(After:=Worksheets(Worksheets.Count))
    wsリスト.Name = "ピッキング_" & Format(Now, "hhnn")
    wsリスト.Range("A1").Value = "ピッキングリスト  " & Format(Now, "yyyy/mm/dd hh:nn")
    wsリスト.Range("A3:F3").Value = Array("棚番", "品番", "品名", "数量", "受注番号", "確認")
    行 = 4
    For i = 5 To 最終行
        wsリスト.Cells(行, 1).Value = 棚番を調べる(ws結果.Cells(i, 2).Value)
        wsリスト.Cells(行, 2).Value = ws結果.Cells(i, 2).Value
        wsリスト.Cells(行, 3).Value = Application.WorksheetFunction.VLookup(ws結果.Cells(i, 2).Value, Worksheets("在庫一覧").Range("A:B"), 2, False)
        wsリスト.Cells(行, 4).Value = ws結果.Cells(i, 3).Value
        wsリスト.Cells(行, 5).Value = ws結果.Cells(i, 1).Value
        wsリスト.Cells(行, 6).Value = "□"
        行 = 行 + 1
    Next i
    ' 棚番順に並べ替える
    wsリスト.Range("A3:F" & 行 - 1).Sort Key1:=wsリスト.Range("A4"), Order1:=xlAscending, Header:=xlYes
    wsリスト.Columns("A:F").AutoFit
    With wsリスト.PageSetup
        .Orientation = xlPortrait
        .PrintTitleRows = "$3:$3"
        .CenterFooter = "&P / &N"
    End With
    wsリスト.PrintOut
    Application.DisplayAlerts = False
    wsリスト.Delete
    Application.DisplayAlerts = True
    Application.ScreenUpdating = True
End Sub

Private Function 棚番を調べる(ByVal 品番 As String) As String
    ' 棚番は品番の先頭2文字で決まっている(例外は下に追加していく)
    Select Case Left(品番, 2)
        Case "P-"
            棚番を調べる = "A-" & Mid(品番, 3, 2)
        Case "B-"
            棚番を調べる = "B-" & Mid(品番, 3, 2)
        Case "S-"
            棚番を調べる = "C-01"
        Case Else
            棚番を調べる = "要確認"
    End Select
    If 品番 = "P-1003" Then 棚番を調べる = "A-99"   ' 2019/7 棚替え
End Function
`;

const FORM = vba`
Option Explicit

Private Sub txt品番_Change()
    Dim ws As Worksheet
    Dim r As Range
    Set ws = Worksheets("在庫一覧")
    lst結果.Clear
    If Len(txt品番.Value) < 3 Then Exit Sub
    For Each r In ws.Range("A5", ws.Cells(ws.Rows.Count, 1).End(xlUp))
        If r.Value Like txt品番.Value & "*" Then
            lst結果.AddItem r.Value & "  " & r.Offset(0, 1).Value & "  在庫 " & (r.Offset(0, 3).Value - r.Offset(0, 4).Value)
        End If
    Next r
End Sub

Private Sub cmd閉じる_Click()
    Unload Me
End Sub
`;

export const ZAIKO: SampleDefinition = {
  file: "在庫引当マクロ.xlsm",
  title: "在庫引当マクロ(在庫取込・自動引当)",
  description:
    "倉庫のPCで開いておくと、在庫データベースから30分ごとに在庫を取り込み、受注残に自動で引き当てるブックです。棚卸結果の取込、発注依頼メールの作成、ピッキングリストの印刷、運送会社のサイトからの出荷状況の取得も行います。VBA は表示用にロックされています。",
  highlights: [
    "ブックを開くと自動で動き出し、30分ごとに自分自身を予約し直す(予約を取り消す処理がない)",
    "64ビット版の Office では動かない書き方(PtrSafe のない Declare)の Windows API 呼び出し",
    "データベースの接続文字列(2 か所にコピー)・コメント・シート保護・共有フォルダの接続にパスワードが直接書かれている(仕様書では伏せ字)",
    "サポートが終了した Internet Explorer を自動操作して出荷状況を取得している",
    "画面から再表示できない「完全に非表示」の設定シートと、パスワードで表示ロックされた VBA",
  ],
  workbook: {
    properties: {
      title: "在庫引当",
      creator: "鈴木次郎",
      lastModifiedBy: "鈴木次郎",
      created: "2018-09-03T08:30:00Z",
      modified: "2020-11-16T12:05:00Z",
      company: "株式会社サンプル精工",
    },
    sheets: [
      {
        name: "在庫一覧",
        codeName: "Sheet1",
        cells: [
          { ref: "A2", value: "最終取込" },
          { ref: "C2", value: "取込者" },
          ...rowLabels("A4", ["品番", "品名", "倉庫コード", "在庫数", "引当済数", "引当可能数", "", "発注点", "仕入先", "発注数"]),
          sharedColumn("F", 5, 54, "D5-E5"),
        ],
        buttons: [
          { kind: "form", text: "今すぐ取込", macro: "在庫取込", col: 11, row: 1, cols: 2, rows: 2 },
          { kind: "form", text: "発注点チェック", macro: "発注点チェック", col: 11, row: 4, cols: 2, rows: 2 },
        ],
      },
      {
        name: "受注残",
        codeName: "Sheet2",
        cells: [...rowLabels("A4", ["受注番号", "受注日", "品番", "納期", "受注数", "引当数", "残数"]), sharedColumn("G", 5, 34, "E5-F5")],
      },
      {
        name: "引当結果",
        codeName: "Sheet3",
        cells: [...rowLabels("A4", ["受注番号", "品番", "引当数", "倉庫コード"])],
        buttons: [{ kind: "shape", text: "ピッキングリスト印刷", macro: "ピッキングリスト印刷", col: 6, row: 1, cols: 3, rows: 2 }],
      },
      {
        name: "出荷状況",
        codeName: "Sheet4",
        cells: [...rowLabels("A4", ["出荷日", "送り状番号", "届け先", "配送状況", "確認日時"])],
        buttons: [{ kind: "shape", text: "出荷状況を更新", macro: "出荷状況を更新", col: 6, row: 1, cols: 2, rows: 2 }],
      },
      {
        name: "棚卸差異",
        codeName: "Sheet6",
        cells: [
          { ref: "A2", value: "月末棚卸の差異(ハンディの取込結果)" },
          ...rowLabels("A4", ["品番", "棚番", "実在庫", "帳簿在庫", "差異", "差異金額"]),
          sharedColumn("F", 5, 24, 'IFERROR(E5*VLOOKUP(A5,単価,2,FALSE),"")'),
        ],
        buttons: [
          { kind: "form", text: "棚卸結果を取込", macro: "棚卸結果を取込", col: 8, row: 1, cols: 2, rows: 2 },
          { kind: "form", text: "在庫DBに反映", macro: "棚卸差異をDBに反映", col: 8, row: 4, cols: 2, rows: 2 },
        ],
      },
      {
        name: "接続設定",
        codeName: "Sheet5",
        state: "veryHidden",
        cells: [
          ...rowLabels("A1", ["サーバー", "SV-ZAIKO01"]),
          ...rowLabels("A2", ["データベース", "在庫管理"]),
          ...rowLabels("A3", ["ユーザー", "zaiko_app"]),
          formula("B5", 'IF(B1="","未設定","設定済")'),
        ],
      },
    ],
    definedNames: [
      { name: "取込先", refersTo: "在庫一覧!$A$5:$E$5000" },
      { name: "単価", refersTo: "接続設定!$D$1:$E$500" },
    ],
    connections: [
      {
        name: "在庫DB",
        type: 1,
        description: "在庫一覧(ピボット用)",
        connection: "DSN=ZAIKO;UID=zaiko_app;PWD=Zaiko#2019!;APP=Microsoft Office;DATABASE=在庫管理",
        command: "SELECT 品番, 品名, 倉庫コード, 在庫数 FROM dbo.V_在庫一覧",
      },
    ],
    vba: {
      locked: true,
      modules: [
        { name: "ThisWorkbook", type: "document", code: THIS_WORKBOOK },
        documentModule("Sheet1"),
        documentModule("Sheet2"),
        documentModule("Sheet3"),
        documentModule("Sheet4"),
        documentModule("Sheet5"),
        documentModule("Sheet6"),
        { name: "frm在庫照会", type: "form", code: FORM },
        { name: "mod在庫取込", type: "standard", code: MOD_IMPORT },
        { name: "mod出荷追跡", type: "standard", code: MOD_TRACKING },
        { name: "mod照会", type: "standard", code: MOD_LOOKUP },
        { name: "mod発注点", type: "standard", code: MOD_ORDER_POINT },
        { name: "mod棚卸", type: "standard", code: MOD_STOCKTAKE },
        { name: "mod帳票", type: "standard", code: MOD_PICKING },
      ],
    },
  },
  expect: {
    findings: [
      "VBA-API-64BIT",
      "CRED-HARDCODED",
      "IE-AUTOMATION",
      "SHELL",
      "HARDCODED-PATH",
      "RESUME-NEXT",
      "NO-ERROR-HANDLING",
      "DATA-CONNECTION",
      "WIN-API",
      "VERY-HIDDEN-SHEET",
      "VBA-LOCKED",
    ],
    absentFindings: ["SENDKEYS", "LONG-PROCEDURE", "NO-OPTION-EXPLICIT", "EXTERNAL-LINK"],
    entryKinds: ["event", "schedule", "shortcut", "button"],
    dependencyKinds: ["connectionString", "dataConnection", "sql", "url", "createObject", "shell", "winApi", "environment", "fileIo", "filePath", "print"],
    secrets: DUMMY_SECRETS,
    complexity: "高",
    checks: (r) => {
      const problems: string[] = [];
      const cred = r.findings.find((f) => f.ruleId === "CRED-HARDCODED");
      // コードの 5 か所(接続文字列の定数・Unprotect・Protect・net use・棚卸の接続文字列)とデータ接続の 1 か所。コメントは数えない
      if (!cred || cred.count < 6) problems.push(`パスワードの直書きが 6 か所検出されていない(${cred?.count ?? 0} か所)`);
      if (!cred?.locations.some((l) => l.part === "データ接続「在庫DB」")) problems.push("データ接続のパスワードが検出されていない");
      if (!cred?.locations.some((l) => l.module === "mod棚卸" && l.procedure === "棚卸差異をDBに反映")) problems.push("コピーされた接続文字列のパスワードが検出されていない");
      const api = r.findings.find((f) => f.ruleId === "VBA-API-64BIT");
      if (api?.count !== 3) problems.push(`PtrSafe のない Declare が 3 件になっていない(${api?.count ?? 0} 件)`);
      const schedule = r.entryPoints.find((e) => e.kind === "schedule");
      if (schedule?.procedure !== "mod在庫取込.定時取込") problems.push("OnTime の予約先(定時取込)が解決されていない");
      const shortcut = r.entryPoints.find((e) => e.kind === "shortcut");
      if (shortcut?.procedure !== "mod照会.在庫照会を開く") problems.push("OnKey の割り当て先(在庫照会を開く)が解決されていない");
      if (!r.entryPoints.some((e) => e.kind === "event" && e.procedure === "ThisWorkbook.Workbook_Open")) problems.push("Workbook_Open が起動のきっかけにない");
      if (!r.vba?.lockedForViewing) problems.push("VBA の表示ロックが検出されていない");
      const masked = r.vba?.modules.find((m) => m.name === "mod在庫取込")?.source ?? "";
      if (
        !masked.includes("Password=****;") ||
        !masked.includes('ws.Unprotect "****"') ||
        !masked.includes("/user:soko ****") ||
        !masked.includes("DBのパスワードは「****」")
      ) {
        problems.push("ソース中のパスワードが伏せ字になっていない箇所がある");
      }
      if (!r.excel?.connections[0]?.connectionString?.includes("PWD=****")) problems.push("データ接続のパスワードが伏せ字になっていない");
      return problems;
    },
  },
};
