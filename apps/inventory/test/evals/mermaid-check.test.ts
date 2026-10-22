import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { businessFlowDiagram, mermaidLabel } from "../../src/doc/mermaid";
import { checkMermaid, extractMermaidBlocks } from "../../evals/mermaid-check";

describe("Mermaid の簡易検査", () => {
  it("保存済みの標準の仕様書(samples/output)の図は、すべて通る", () => {
    const dir = path.join(__dirname, "../../samples/output");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
    expect(files.length).toBeGreaterThanOrEqual(4);
    let blocks = 0;
    for (const f of files) {
      for (const b of extractMermaidBlocks(fs.readFileSync(path.join(dir, f), "utf8"))) {
        blocks++;
        expect(checkMermaid(b), f).toEqual([]);
      }
    }
    expect(blocks).toBeGreaterThan(0);
  });

  it("AI の業務フローの図は、変な文字を含むラベルでも通る(組み立ては mermaid.ts)", () => {
    const code = businessFlowDiagram([
      { id: "a", label: '請求書を"発行"する <b>#1</b> `x`', actor: "利用者", next: ["b"] },
      { id: "b", label: "DB(共有)へ書き込み", actor: "外部システム", next: ["c", "zzz"] },
      { id: "c", label: "終了", actor: "マクロ", next: [] },
    ]);
    expect(checkMermaid(code)).toEqual([]);
    expect(mermaidLabel('a"b')).toBe('"a#quot;b"');
  });

  it("壊れた図を見つける: 宣言なし・引用符・かっこ・未定義のノード・コードフェンス・ラベルの生の山かっこ", () => {
    const bad = (code: string) => checkMermaid(code).map((i) => i.message).join(" | ");
    expect(bad('graph TD\n  s1["a"]')).toContain("flowchart");
    expect(bad('flowchart TD\n  s1["a')).toContain("引用符");
    expect(bad('flowchart TD\n  s1["a"] --> s2')).toContain("定義されていない");
    expect(bad('flowchart TD\n  s1["a"\n')).toContain("[]");
    expect(bad('flowchart TD\n  s1["a```b"]')).toContain("コードフェンス");
    expect(bad('flowchart TD\n  s1["<img src=x>"]')).toContain("< >");
    expect(bad('flowchart TD\n  s1["a #b"]')).toContain("文字参照");
    expect(bad("flowchart TD\n  s1 ==> s2")).toContain("解釈できない");
    expect(bad("")).toContain("空");
    expect(checkMermaid('flowchart LR\n  s1(["a"]) -->|"x"| s2[("b")]')).toEqual([]);
  });

  it("```mermaid ブロックだけを取り出す", () => {
    const md = "text\n```mermaid\nflowchart TD\n  a[\"x\"]\n```\n\n```sql\nSELECT 1\n```\n";
    expect(extractMermaidBlocks(md)).toEqual(['flowchart TD\n  a["x"]']);
  });
});
