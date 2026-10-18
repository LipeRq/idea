// テスト用の「よくある中小企業のマクロ」。日本語のコメント・プロシージャ名・モジュール名を含む。
import type { TestModule, TestProject } from "./ovba";

export const THIS_WORKBOOK: TestModule = {
  name: "ThisWorkbook",
  type: "document",
  code: `Option Explicit

Private Sub Workbook_Open()
    ' 起動時にメニューを初期化する
    Call 初期化
    Application.OnTime Now + TimeValue("00:10:00"), "売上集計.定時バックアップ"
End Sub`,
};

export const SHEET1: TestModule = {
  name: "Sheet1",
  type: "document",
  code: `Private Sub Worksheet_Change(ByVal Target As Range)
    If Target.Column = 2 Then 再計算 Target.Row
End Sub`,
};

export const SALES: TestModule = {
  name: "売上集計",
  type: "standard",
  code: `Option Explicit

Private Declare Function GetTickCount Lib "kernel32" () As Long
Public Const 保存先 As String = "\\\\fileserver\\share\\売上\\"

' 売上データを集計してCSVに出力する
Public Sub 集計実行()
    On Error GoTo ErrHandler
    Dim cn As Object
    Set cn = CreateObject("ADODB.Connection")
    cn.Open "Provider=SQLOLEDB;Data Source=SV01;Initial Catalog=Sales;User ID=sa;Password=P@ssw0rd;"
    Dim rs As Object
    Set rs = cn.Execute("SELECT * FROM 売上 WHERE 日付 >= '2024-01-01'")
    Call 明細出力(rs, "C:\\Users\\tanaka\\Desktop\\売上.csv")
    MsgBox "集計が完了しました" ' 完了メッセージ
    Exit Sub
ErrHandler:
    MsgBox "エラー: " & Err.Description
End Sub

Private Sub 明細出力(ByVal rs As Object, ByVal 出力先 As String)
    Dim f As Integer
    f = FreeFile
    Open 出力先 For Output As #f
    Do Until rs.EOF
        Print #f, rs.Fields(0).Value
        rs.MoveNext
    Loop
    Close #f
End Sub

Public Function 税込金額(ByVal 金額 As Currency, Optional ByVal 税率 As Double = 0.1) As Currency
    税込金額 = 金額 * (1 + 税率)
End Function

Sub CSV出力()
    Workbooks.Open "C:\\データ\\単価表.xlsx"
    SendKeys "^s"
    Shell "notepad.exe C:\\temp\\log.txt", vbNormalFocus
End Sub

Sub 定時バックアップ()
    On Error Resume Next
    ThisWorkbook.SaveCopyAs 保存先 & "backup.xlsm"
End Sub

Public Sub 初期化()
    UserForm1.Show
End Sub

Public Sub 再計算(ByVal 行 As Long)
    Dim 顧客 As New CCustomer
    顧客.名前 = Cells(行, 1).Value
    Application.Run "売上集計.集計実行"
End Sub

Public Function 長い引数(ByVal a As Long, _
                        ByVal b As Long) As Long
    長い引数 = a + _
        b
End Function

Sub 未使用の手動マクロ()
    Debug.Print "手動"
End Sub`,
};

export const CUSTOMER: TestModule = {
  name: "CCustomer",
  type: "class",
  code: `Option Explicit
Private m名前 As String

Public Property Get 名前() As String
    名前 = m名前
End Property

Public Property Let 名前(ByVal v As String)
    m名前 = v
End Property

Private Sub Class_Initialize()
    m名前 = ""
End Sub`,
};

export const USER_FORM: TestModule = {
  name: "UserForm1",
  type: "form",
  code: `Private Sub UserForm_Initialize()
    Me.Caption = "売上メニュー"
End Sub

Private Sub CommandButton1_Click()
    売上集計.集計実行
    Unload Me
End Sub`,
};

export const SAMPLE_PROJECT: TestProject = {
  modules: [THIS_WORKBOOK, SHEET1, SALES, CUSTOMER, USER_FORM],
  locked: true,
};
