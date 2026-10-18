import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeBuffer, PasswordError } from "../src";
import { readRelationships } from "../src/access/access";
import { accessStorage, type StorageRow } from "../src/access/storage";
import { analyzeVbaProject } from "../src/vba/analyze";
import { extractVbaProject } from "../src/vba/project";
import { buildVbaStreams } from "./helpers/ovba";

const fixture = (name: string, password?: string) => {
  const buf = readFileSync(fileURLToPath(new URL(`./fixtures/access/${name}`, import.meta.url)));
  return analyzeBuffer(new Uint8Array(buf), name, { password });
};

// Jackcess の QueryTest.testReadQueries と同じ期待値(末尾の NUL は除いている)
const EXPECTED_SQL: Record<string, string> = {
  SelectQuery: `SELECT DISTINCT Table1.*, Table2.col1, Table2.col2, Table3.col3
FROM (Table1 LEFT JOIN Table3 ON Table1.col1 = Table3.col1) INNER JOIN Table2 ON (Table3.col1 = Table2.col2) AND (Table3.col1 = Table2.col1)
WHERE (((Table2.col2)="foo" Or (Table2.col2) In ("buzz","bazz")))
ORDER BY Table2.col1;`,
  DeleteQuery: `DELETE Table1.col1, Table1.col2, Table1.col3
FROM Table1
WHERE (((Table1.col1)>"blah"));`,
  AppendQuery: `INSERT INTO Table3 (col2, col2, col3)
SELECT [Table1].[col2], [Table2].[col2], [Table2].[col3]
FROM Table3, Table1 INNER JOIN Table2 ON [Table1].[col1]=[Table2].[col1];`,
  UpdateQuery: `PARAMETERS User Name Text;
UPDATE Table1
SET Table1.col1 = "foo", Table1.col2 = [Table2].[col3], [Table2].[col1] = [User Name]
WHERE ((([Table2].[col1]) Is Not Null));`,
  MakeTableQuery: `SELECT Max(Table2.col1) AS MaxOfcol1, Table2.col2, Table3.col2 INTO Table4
FROM (Table2 INNER JOIN Table1 ON Table2.col1 = Table1.col2) RIGHT JOIN Table3 ON Table1.col2 = Table3.col3
GROUP BY Table2.col2, Table3.col2
HAVING (((Max(Table2.col1))="buzz") AND ((Table2.col2)<>"blah"));`,
  CrosstabQuery: `TRANSFORM Count([Table2].[col2]) AS CountOfcol2
SELECT Table2_1.col1, [Table2].[col3], Avg(Table2_1.col2) AS AvgOfcol2
FROM (Table1 INNER JOIN Table2 ON [Table1].[col1]=[Table2].[col1]) INNER JOIN Table2 AS Table2_1 ON [Table2].[col1]=Table2_1.col3
WHERE ((([Table1].[col1])>"10") And ((Table2_1.col1) Is Not Null) And ((Avg(Table2_1.col2))>"10"))
GROUP BY Table2_1.col1, [Table2].[col3]
ORDER BY [Table2].[col3]
PIVOT [Table1].[col1];`,
  UnionQuery: `Select Table1.col1, Table1.col2
where Table1.col1 = "foo"
UNION
Select Table2.col1, Table2.col2
UNION ALL Select Table3.col1, Table3.col2
where Table3.col3 > "blah";`,
  PassthroughQuery: "ALTER TABLE Table4 DROP COLUMN col5;",
  DataDefinitionQuery: "CREATE TABLE Table5 (col1 CHAR, col2 CHAR);",
};

describe("保存済みクエリの SQL 復元", () => {
  for (const file of ["queryTestV2010.accdb", "queryTestV2003.mdb"]) {
    it(file, () => {
      const r = fixture(file);
      expect(r.file.format).toBe(file.endsWith(".mdb") ? "mdb" : "accdb");
      const sql = Object.fromEntries(r.access!.queries.map((q) => [q.name, q.sql]));
      expect(sql).toEqual(EXPECTED_SQL);
      const types = Object.fromEntries(r.access!.queries.map((q) => [q.name, q.type]));
      expect(types).toMatchObject({ CrosstabQuery: "crosstab", UnionQuery: "union", PassthroughQuery: "passThrough", MakeTableQuery: "makeTable" });
      expect(r.access!.queries.find((q) => q.name === "SelectQuery")!.tables).toEqual(["Table1", "Table2", "Table3"]);
    });
  }

  it("テーブル定義と件数", () => {
    const r = fixture("queryTestV2010.accdb");
    expect(r.access!.engine).toBe("ACE14(Access 2010)");
    expect(r.access!.tables.map((t) => [t.name, t.columns.map((c) => `${c.name}:${c.type}`).join(",")])).toEqual([
      ["Table1", "col1:text,col2:text,col3:text"],
      ["Table2", "col1:text,col2:text,col3:text"],
      ["Table3", "col1:text,col2:text,col3:text"],
    ]);
    expect(r.stats.tableCount).toBe(3);
    expect(r.vba!.name).toBe("queryTest");
    expect(r.access!.vbaStatus).toBe("none");
  });
});

describe("リンクテーブル・リレーションシップ", () => {
  it("Access のリンクテーブルとリレーションシップ", () => {
    const r = fixture("linkerTestV2007.accdb");
    expect(r.access!.linkedTables).toEqual([
      { name: "Table2", kind: "access", sourceTable: "Table1", database: "Z:\\jackcess_test\\linkeeTest.accdb", connect: null },
    ]);
    expect(r.access!.relationships).toEqual([
      {
        name: "Table1Table2",
        primaryTable: "Table1",
        primaryColumns: ["Field1"],
        foreignTable: "Table2",
        foreignColumns: ["Field1"],
        oneToOne: false,
        enforced: false,
        cascadeUpdate: false,
        cascadeDelete: false,
      },
    ]);
    expect(r.findings.map((f) => f.ruleId)).toContain("LINKED-TABLE");
  });

  it("ODBC リンクテーブルの接続文字列はパスワードをマスクし、リスクとして挙げる", () => {
    const r = fixture("odbcLinkerTestV2007.accdb");
    const odbc = r.access!.linkedTables[0];
    expect(odbc).toMatchObject({ name: "Ordrar", kind: "odbc", sourceTable: "dbo.Ordrar" });
    expect(odbc.connect).toContain("PWD=****;");
    expect(JSON.stringify(r)).not.toContain("DummyPassword");
    expect(r.findings.find((f) => f.ruleId === "CRED-HARDCODED")?.locations).toEqual([{ part: "リンクテーブル「Ordrar」" }]);
    expect(r.access!.queries.every((q) => q.hidden)).toBe(true);
    expect(r.stats.queryCount).toBe(0);
  });

  it("参照整合性・連鎖更新/削除のフラグ", () => {
    const rels = readRelationships([
      { szRelationship: "顧客受注", grbit: 0x1100, icolumn: 1, szObject: "受注", szColumn: "枝番", szReferencedObject: "顧客", szReferencedColumn: "枝番" },
      { szRelationship: "顧客受注", grbit: 0x1100, icolumn: 0, szObject: "受注", szColumn: "顧客ID", szReferencedObject: "顧客", szReferencedColumn: "ID" },
      { szRelationship: "MSysAccessStorageSTGREL", grbit: 0, icolumn: 0, szObject: "MSysAccessStorage", szColumn: "ParentId", szReferencedObject: "MSysAccessStorage", szReferencedColumn: "Id" },
    ]);
    expect(rels).toEqual([
      {
        name: "顧客受注",
        primaryTable: "顧客",
        primaryColumns: ["ID", "枝番"],
        foreignTable: "受注",
        foreignColumns: ["顧客ID", "枝番"],
        oneToOne: false,
        enforced: true,
        cascadeUpdate: true,
        cascadeDelete: true,
      },
    ]);
  });
});

describe("Access の VBA(MSysAccessStorage)", () => {
  it("ストレージのツリーから標準モジュールとフォームモジュールを取り出す", () => {
    const streams = buildVbaStreams({
      modules: [
        { name: "共通処理", type: "standard", code: "Option Explicit\n' 受注データを取り込む\nPublic Sub 取込()\n    DoCmd.TransferText acImportDelim, , \"受注\", \"\\\\nas\\受注\\受注.csv\"\n    DoCmd.OpenForm \"受注一覧\"\nEnd Sub" },
        { name: "Form_受注一覧", type: "class", code: "Private Sub Form_Load()\n    Me.Caption = \"受注\"\nEnd Sub\n\nPrivate Sub cmd取込_Click()\n    取込\nEnd Sub" },
      ],
    });
    // ROOT(1) → VBA(3) → VBAProject(4) → VBA(5) のツリーを組み立てる
    const rows: StorageRow[] = [
      { id: 1, parentId: 1, name: "MSysAccessStorage_ROOT", type: 1, data: null },
      { id: 3, parentId: 1, name: "VBA", type: 1, data: null },
      { id: 4, parentId: 3, name: "VBAProject", type: 1, data: null },
      { id: 5, parentId: 4, name: "VBA", type: 1, data: null },
    ];
    let id = 100;
    for (const [path, data] of streams) {
      const [first, second] = path.split("/");
      rows.push(second ? { id: id++, parentId: 5, name: second, type: 2, data } : { id: id++, parentId: 4, name: first, type: 2, data });
    }

    const warnings: string[] = [];
    const raw = extractVbaProject(accessStorage(rows), warnings)!;
    expect(warnings).toEqual([]);
    expect(raw.modules.map((m) => [m.name, m.type])).toEqual([
      ["共通処理", "standard"],
      ["Form_受注一覧", "form"],
    ]);
    expect(raw.modules[0].source).toContain("' 受注データを取り込む");

    const analysis = analyzeVbaProject(raw, { host: "access", includeSource: true });
    expect(analysis.callGraph.map((e) => `${e.from}->${e.to}:${e.kind}`)).toEqual([
      "共通処理.取込->Form_受注一覧:formShow",
      "Form_受注一覧.cmd取込_Click->共通処理.取込:call",
    ]);
    expect(analysis.entryPoints.map((e) => e.trigger)).toEqual([
      "フォーム 受注一覧 / 読み込まれたとき",
      "cmd取込(受注一覧) / クリックしたとき",
    ]);
    expect(analysis.dependencies.find((d) => d.kind === "fileIo")).toMatchObject({ target: "\\\\nas\\受注\\受注.csv", category: "DoCmd.TransferText" });
    expect(analysis.dependencies.find((d) => d.kind === "filePath")?.target).toBe("\\\\nas\\受注\\受注.csv");
  });
});

describe("データベースパスワード", () => {
  it("パスワードが無い・違うときは PasswordError", () => {
    expect(() => fixture("V2010_with-password.accdb")).toThrow(PasswordError);
    expect(() => fixture("V2010_with-password.accdb", "wrong")).toThrow("パスワードが違います");
  });

  it("正しいパスワードなら読める", () => {
    const r = fixture("V2010_with-password.accdb", "password");
    expect(r.file.format).toBe("accdb");
    expect(r.access!.engine).toBe("ACE14(Access 2010)");
  });
});
