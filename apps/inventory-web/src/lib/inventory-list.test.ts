import { describe, expect, it } from "vitest";
import type { TestModule } from "@engine-test/helpers/ovba";
import { SAMPLE_PROJECT } from "@engine-test/helpers/sampleVba";
import { buildXlsm } from "@engine-test/helpers/workbooks";
import { accessFixture, fakeFile } from "@/test/fixtures";
import { analyzeFile } from "@/worker/handle";
import { csvCell, graphOf, inventoryCsv, inventoryHtmlBody, inventoryMarkdown, summarize, toRows, type InventoryItem } from "./inventory-list";

const LINK_MODULE: TestModule = {
  name: "連携",
  type: "standard",
  code: `Option Explicit
Public Sub 開く()
    Workbooks.Open "C:\\共有\\売上管理.xlsm"
    Dim cn As Object
    Set cn = CreateObject("ADODB.Connection")
    cn.Open "Provider=Microsoft.ACE.OLEDB.12.0;Data Source=C:\\共有\\台帳.accdb;"
    cn.Open "Provider=SQLOLEDB;Server=sql01;Database=sales;"
End Sub`,
};

const now = new Date("2026-10-20T00:00:00Z");

async function items(): Promise<InventoryItem[]> {
  const done = async (id: string, name: string, bytes: Uint8Array): Promise<InventoryItem> => ({
    id,
    fileName: name,
    outcome: "done",
    result: await analyzeFile(fakeFile(bytes, name), {}, () => undefined, now),
    ai: null,
  });
  return [
    await done("a", "連携元.xlsm", buildXlsm({ modules: [...SAMPLE_PROJECT.modules, LINK_MODULE] })),
    await done("b", "売上管理.xlsm", buildXlsm(SAMPLE_PROJECT)),
    await done("c", "台帳.accdb", accessFixture("queryTestV2010.accdb")),
    { id: "d", fileName: "壊れ=ている.xlsm", outcome: "failed", failure: { code: "corrupt", message: "壊れています" } },
    { id: "e", fileName: "議事録.docx", outcome: "skipped", reason: "この形式(.docx)には対応していません" },
  ];
}

describe("棚卸し一覧", () => {
  it("行: 解析済み・エラー・対象外。規模・リスク・移行難易度・外部依存が入る", async () => {
    const rows = toRows(await items());
    expect(rows.map((r) => r.status)).toEqual(["解析済み", "解析済み", "解析済み", "エラー", "対象外"]);
    const a = rows[0];
    expect(a.modules).toBeGreaterThan(0);
    expect(a.codeLines).toBeGreaterThan(0);
    expect(["低", "中", "高"]).toContain(a.difficulty);
    expect(a.externalSummary).toMatch(/他のブック \d+/);
    expect(a.externalSummary).toMatch(/Access \d+/);
    expect(a.externalSummary).toMatch(/DB \d+/);
    expect(a.externalCount).toBeGreaterThanOrEqual(3);
    expect(a.externalList.some((l) => l.startsWith("売上管理.xlsm(他のブック") && l.includes("マクロで開く"))).toBe(true);
    expect(a.externalList.some((l) => l.startsWith("台帳.accdb(Access"))).toBe(true);
    expect(a.externalList.some((l) => l.startsWith("sql01(DB"))).toBe(true);
    // Access は、シートではなくテーブル・クエリ
    expect(rows[2].tables).not.toBeNull();
    expect(rows[2].sheets).toBeNull();
    expect(rows[3].note).toContain("壊れています");
    expect(rows[4].note).toContain(".docx");
    expect(summarize(rows)).toMatchObject({ total: 5, done: 3, failed: 1, skipped: 1 });
  });

  it("関係図: 解析したファイルどうし(大文字小文字を区別しない)と、未解析の参照先をつなぐ", async () => {
    const graph = graphOf(await items());
    expect(graph).not.toBeNull();
    const byLabel = (label: string) => graph!.nodes.find((n) => n.label === label);
    expect(byLabel("売上管理.xlsm")?.analyzed).toBe(true);
    expect(byLabel("台帳.accdb")?.analyzed).toBe(true);
    expect(byLabel("sql01")?.analyzed).toBe(false);
    expect(graph!.code).toContain("flowchart LR");
  });

  it("CSV: BOM・CRLF・引用符。式として実行されうる先頭の文字には ' を付ける", async () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("-1+2")).toBe("'-1+2");
    expect(csvCell("売上管理")).toBe("売上管理");
    const csv = inventoryCsv(toRows(await items()));
    expect(csv.startsWith("\uFEFFファイル名,状態,")).toBe(true);
    expect(csv).toContain("\r\n");
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(6);
    expect(lines[4]).toContain("壊れ=ている.xlsm");
  });

  it("Markdown と HTML: 表・エラーの理由・関係図が入り、HTML はスクリプトを含まず値をエスケープする", async () => {
    const list = await items();
    const rows = toRows(list);
    const graph = graphOf(list);
    const md = inventoryMarkdown(rows, graph, now);
    expect(md).toContain("# 棚卸し一覧");
    expect(md).toContain("| 連携元.xlsm |");
    expect(md).toContain("## 解析できなかったファイル");
    expect(md).toContain("```mermaid");
    const html = inventoryHtmlBody([{ ...rows[0], fileName: "<script>alert(1)</script>.xlsm" }, ...rows.slice(1)], graph, null, now);
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<pre>");
    const withSvg = inventoryHtmlBody(rows, graph, "<svg></svg>", now);
    expect(withSvg).toContain("<svg></svg>");
    expect(inventoryMarkdown(rows.slice(1, 2), null, now)).toContain("見つかりませんでした");
  });
});
