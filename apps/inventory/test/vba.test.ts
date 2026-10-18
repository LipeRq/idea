import CFB from "cfb";
import iconv from "iconv-lite";
import { describe, expect, it } from "vitest";
import { readCompoundFile } from "../src/ole/compoundFile";
import { decompressContainer } from "../src/vba/decompress";
import { parseDirStream } from "../src/vba/dir";
import { cfbStorage, extractVbaProject } from "../src/vba/project";
import { decryptProjectData, parseProjectStream } from "../src/vba/projectStream";
import { analyzeVbaProject } from "../src/vba/analyze";
import { addStreams, buildDirStream, buildProjectStream, buildVbaProjectBin, buildVbaStreams, encryptProjectData, PROJECT_ID } from "./helpers/ovba";
import { SALES, SAMPLE_PROJECT } from "./helpers/sampleVba";

function extract(bin: Uint8Array) {
  const warnings: string[] = [];
  const project = extractVbaProject(cfbStorage(readCompoundFile(bin)), warnings);
  return { project: project!, warnings };
}

describe("dir ストリーム", () => {
  it("コードページ・プロジェクト名・参照設定・モジュール一覧を読む", () => {
    const dir = parseDirStream(buildDirStream({ ...SAMPLE_PROJECT, name: "売上VBA" }, [10, 20, 30, 40, 50]));
    expect(dir.codePage).toBe(932);
    expect(dir.projectName).toBe("売上VBA");
    expect(dir.docString).toBe("テスト用プロジェクト");
    expect(dir.references.map((r) => [r.name, r.kind])).toEqual([
      ["stdole", "registered"],
      ["ADODB", "registered"],
      ["MSForms", "control"],
    ]);
    expect(dir.modules.map((m) => [m.name, m.offset, m.procedural])).toEqual([
      ["ThisWorkbook", 10, false],
      ["Sheet1", 20, false],
      ["売上集計", 30, true],
      ["CCustomer", 40, false],
      ["UserForm1", 50, false],
    ]);
  });
});

describe("PROJECT ストリーム", () => {
  it("2.4.3 の暗号化データを復号できる", () => {
    const data = Uint8Array.of(1, 2, 3, 250);
    for (const seed of [0x00, 0x02, 0x06, 0xff]) {
      expect(decryptProjectData(encryptProjectData(data, PROJECT_ID, seed))).toEqual(data);
    }
  });

  it("モジュール種別と、表示ロック・パスワードの有無を判定する", () => {
    const locked = parseProjectStream(buildProjectStream(SAMPLE_PROJECT), 932);
    expect(Object.fromEntries(locked.moduleKinds)).toEqual({
      thisworkbook: "document",
      sheet1: "document",
      売上集計: "standard",
      ccustomer: "class",
      userform1: "designer",
    });
    expect(locked.lockedForViewing).toBe(true);
    expect(locked.hasPassword).toBe(true);

    const open = parseProjectStream(buildProjectStream({ ...SAMPLE_PROJECT, locked: false }), 932);
    expect(open.lockedForViewing).toBe(false);
    expect(open.hasPassword).toBe(false);
  });
});

describe("vbaProject.bin からのソース抽出", () => {
  it("cp932 の日本語(モジュール名・コメント・プロシージャ名)を正しくデコードする", () => {
    const { project, warnings } = extract(buildVbaProjectBin(SAMPLE_PROJECT));
    expect(warnings).toEqual([]);
    expect(project.codePage).toBe(932);
    expect(project.encoding).toBe("cp932");
    const sales = project.modules.find((m) => m.name === "売上集計")!;
    expect(sales.type).toBe("standard");
    expect(sales.source).toContain("' 売上データを集計してCSVに出力する");
    expect(sales.source).toContain("Public Sub 集計実行()");
    expect(sales.source).toBe(SALES.code);
    expect(sales.attributes.VB_Name).toBe("売上集計");
    expect(sales.source).not.toMatch(/^Attribute /m);
  });

  it("モジュール種別(標準/クラス/ドキュメント/フォーム)を判定する", () => {
    const { project } = extract(buildVbaProjectBin(SAMPLE_PROJECT));
    expect(project.modules.map((m) => [m.name, m.type])).toEqual([
      ["ThisWorkbook", "document"],
      ["Sheet1", "document"],
      ["売上集計", "standard"],
      ["CCustomer", "class"],
      ["UserForm1", "form"],
    ]);
    expect(project.lockedForViewing).toBe(true);
  });

  it("PROJECT ストリームが無くても dir と VB_Base から種別を推定する", () => {
    const { project } = extract(buildVbaProjectBin({ ...SAMPLE_PROJECT, omitProjectStream: true }));
    expect(project.modules.map((m) => m.type)).toEqual(["document", "document", "standard", "class", "form"]);
    expect(project.lockedForViewing).toBeNull();
  });

  it("cp1252 のプロジェクトも読める", () => {
    const { project } = extract(
      buildVbaProjectBin({
        codePage: 1252,
        modules: [{ name: "Módulo1", type: "standard", code: "' Café\nSub Olá()\nEnd Sub" }],
      }),
    );
    expect(project.modules[0].name).toBe("Módulo1");
    expect(project.modules[0].source).toBe("' Café\nSub Olá()\nEnd Sub");
  });

  it("4096 バイトを超える長いモジュールも欠けずに読める", () => {
    const code = Array.from({ length: 300 }, (_, i) => `' ${i}行目のコメント(日本語)\nSub 処理${i}()\nEnd Sub`).join("\n");
    const { project } = extract(buildVbaProjectBin({ modules: [{ name: "大きいモジュール", type: "standard", code }] }));
    expect(iconv.encode(code, "cp932").length).toBeGreaterThan(4096 * 3);
    expect(project.modules[0].source).toBe(code);
  });

  it("モジュールのストリームが欠けていたら警告を出して続行する", () => {
    // cfb_del してから書き直すと cfb がツリーを壊すため、最初からストリームを入れずに組み立てる
    const streams = buildVbaStreams(SAMPLE_PROJECT);
    streams.delete("VBA/CCustomer");
    const container = CFB.utils.cfb_new();
    addStreams(container, "", streams);
    const bin = new Uint8Array(CFB.write(container, { type: "buffer", fileType: "cfb" }) as Buffer);
    const warnings: string[] = [];
    const project = extractVbaProject(cfbStorage(readCompoundFile(bin)), warnings)!;
    expect(project.modules).toHaveLength(5);
    expect(warnings).toEqual(["モジュール「CCustomer」のストリームが見つかりません"]);
  });

  it("dir ストリームの解凍結果は spec どおりのレコード列になっている", () => {
    const dir = decompressContainer(cfbStorage(readCompoundFile(buildVbaProjectBin(SAMPLE_PROJECT))).read("VBA/dir")!);
    expect(dir[0] | (dir[1] << 8)).toBe(0x0001); // PROJECTSYSKIND から始まる
    expect([...dir.subarray(dir.length - 6)]).toEqual([0x10, 0, 0, 0, 0, 0]); // 終端
  });
});

describe("analyzeVbaProject(依存・呼び出しの検出)", () => {
  const raw = (code: string, more: { name: string; type: "standard" | "class"; source: string }[] = []) => ({
    name: "VBAProject",
    codePage: 932,
    encoding: "cp932",
    lockedForViewing: false,
    hasPassword: false,
    references: [],
    modules: [{ name: "Module1", streamName: "Module1", type: "standard" as const, source: code, attributes: {} }, ...more.map((m) => ({ ...m, streamName: m.name, attributes: {} }))],
  });

  it("COM オブジェクト・ファイル操作・環境変数・印刷", () => {
    const a = analyzeVbaProject(
      raw(`Sub A()
    Dim cn As New ADODB.Connection
    Dim fso As New FileSystemObject
    Dim c As New Collection
    Set ol = CreateObject("Outlook.Application")
    Set ie = CreateObject("InternetExplorer.Application")
    Set xl = GetObject(, "Excel.Application")
    Set wb = GetObject("C:\\data\\在庫.xlsx")
    Dim Shell As Object
    Kill "C:\\temp\\*.tmp"
    user = Environ("USERNAME")
    ActiveSheet.PrintOut
End Sub`),
      { host: "excel", includeSource: true },
    );
    const deps = a.dependencies.map((d) => `${d.kind}:${d.target}:${d.category}`);
    expect(deps).toEqual([
      "createObject:ADODB.Connection:データベース接続(参照設定)",
      "createObject:Scripting.FileSystemObject:ファイル操作(参照設定)",
      "createObject:Outlook.Application:メール送信",
      "createObject:InternetExplorer.Application:Internet Explorer 自動操作(サポート終了)",
      "createObject:Excel.Application:Office連携",
      "filePath:C:\\data\\在庫.xlsx:ローカルドライブ",
      "workbook:C:\\data\\在庫.xlsx:GetObject",
      "filePath:C:\\temp\\*.tmp:ローカルドライブ",
      "fileIo:C:\\temp\\*.tmp:Kill",
      "environment:USERNAME:null",
      "print:PrintOut:null",
    ]);
  });

  it("With ブロックのメンバーやオブジェクト変数のメソッドは呼び出しとみなさない", () => {
    const a = analyzeVbaProject(
      raw(
        `Sub Main()
    With ws
        .Range("A1").Value = 1
        .Calc
    End With
    obj.Calc
    Module2.Calc
    Run "'売上.xlsm'!Module2.Calc"
    Application.OnKey "^q", "Main"
End Sub

Private Sub Calc()
End Sub`,
        [{ name: "Module2", type: "standard", source: "Public Sub Calc()\nEnd Sub" }],
      ),
      { host: "excel", includeSource: true },
    );
    expect(a.callGraph.map((e) => `${e.from}->${e.to}:${e.kind}`)).toEqual(["Module1.Main->Module2.Calc:call", "Module1.Main->Module2.Calc:run"]);
    expect(a.entryPoints).toEqual([
      expect.objectContaining({ kind: "shortcut", trigger: "キー「^q」を押したとき(Application.OnKey)", procedure: "Module1.Main" }),
    ]);
  });
});
