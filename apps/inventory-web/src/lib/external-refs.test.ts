import { describe, expect, it } from "vitest";
import type { Dependency } from "@engine/browser";
import { baseName, buildFileGraph, extractExternalRefs, mermaidLabel, summarizeExternalRefs } from "./external-refs";

const dep = (kind: Dependency["kind"], target: string, category: string | null = null): Dependency => ({ kind, target, category, location: {} });

describe("baseName", () => {
  it("パス・URL・[ブック名] からファイル名を取り出す", () => {
    expect(baseName("C:\\共有\\売上 管理.xlsm")).toBe("売上 管理.xlsm");
    expect(baseName("\\\\srv\\share\\a.accdb")).toBe("a.accdb");
    expect(baseName("file:///C:/data/%E5%A3%B2%E4%B8%8A.xlsx")).toBe("売上.xlsx");
    expect(baseName("[Book1.xlsx]")).toBe("Book1.xlsx");
  });
});

describe("extractExternalRefs", () => {
  it("他のブック・Access・DB への参照を種類ごとに取り出し、同じ参照先はまとめる", () => {
    const refs = extractExternalRefs([
      dep("workbook", "C:\\共有\\売上.xlsm", "Workbooks.Open"),
      dep("externalLink", "file:///C:/共有/売上.xlsm", "workbook"),
      dep("filePath", "\\\\srv\\d\\台帳.accdb", "ネットワーク共有"),
      dep("connectionString", "Provider=Microsoft.ACE.OLEDB.12.0;Data Source=C:\\d\\顧客.mdb;"),
      dep("connectionString", "Provider=SQLOLEDB;Server=sql01;Database=sales;"),
      dep("dataConnection", "DSN=基幹DB;UID=x"),
      dep("linkedTable", "C:\\d\\マスタ.accdb", "access"),
      dep("filePath", "C:\\out\\結果.csv", "ローカルドライブ"),
      dep("url", "https://example.com/a.xlsx"),
      dep("externalLink", "\\\\srv\\d\\ole.xls", "dde"),
    ]);
    const label = (r: (typeof refs)[number]) => `${r.kind}:${r.name}`;
    expect(refs.map(label).sort()).toEqual(
      ["access:マスタ.accdb", "access:台帳.accdb", "access:顧客.mdb", "book:売上.xlsm", "database:sql01", "database:基幹DB"].sort(),
    );
    const sales = refs.find((r) => r.name === "売上.xlsm")!;
    expect(sales.count).toBe(2);
    expect(sales.via).toEqual(["マクロで開く", "数式のリンク"]);
    expect(summarizeExternalRefs(refs)).toBe("他のブック 1・Access 3・DB 2");
    expect(summarizeExternalRefs([])).toBe("なし");
  });
});

describe("buildFileGraph", () => {
  const refs = (list: Dependency[]) => extractExternalRefs(list);
  it("解析したファイルどうしと、未解析の参照先をつなぐ。参照が無ければ null", () => {
    const graph = buildFileGraph([
      { name: "連携元.xlsm", kind: "excel", refs: refs([dep("workbook", "C:\\a\\売上.XLSM"), dep("filePath", "C:\\a\\月次.xlsx"), dep("connectionString", "Server=sql01;")]) },
      { name: "売上.xlsm", kind: "excel", refs: refs([dep("linkedTable", "C:\\a\\台帳.accdb", "access")]) },
      { name: "台帳.accdb", kind: "access", refs: [] },
      { name: "孤立.xlsm", kind: "excel", refs: [] },
    ]);
    expect(graph).not.toBeNull();
    const labels = graph!.nodes.map((n) => `${n.label}${n.analyzed ? "" : "(未解析)"}`);
    expect(labels).toContain("売上.xlsm");
    expect(labels).toContain("月次.xlsx(未解析)");
    expect(labels).not.toContain("孤立.xlsm");
    // 大文字小文字を区別せず、解析したファイルと一致する
    expect(graph!.nodes.find((n) => n.label === "売上.xlsm")?.analyzed).toBe(true);
    expect(graph!.nodes.find((n) => n.label === "台帳.accdb")?.analyzed).toBe(true);
    expect(graph!.code).toMatch(/^flowchart LR/);
    expect(graph!.code).toContain("マクロで開く");
    expect(buildFileGraph([{ name: "a.xlsm", kind: "excel", refs: [] }])).toBeNull();
    // 自分自身への参照は図に出さない
    expect(buildFileGraph([{ name: "a.xlsm", kind: "excel", refs: refs([dep("workbook", "C:\\a.xlsm")]) }])).toBeNull();
  });

  it("参照先が多すぎるときは、ノードの上限で打ち切って数を返す", () => {
    const many = Array.from({ length: 80 }, (_, i) => dep("filePath", `C:\\x\\b${i}.xlsx`));
    const graph = buildFileGraph([{ name: "a.xlsm", kind: "excel", refs: refs(many) }], 20);
    expect(graph!.nodes.length).toBe(20);
    expect(graph!.omitted).toBe(80 - 19);
  });

  it("ラベルの記号は無害化する", () => {
    expect(mermaidLabel('a"b<c>`d#')).toBe('"a#quot;b#lt;c#gt;#96;d#35;"');
  });
});
