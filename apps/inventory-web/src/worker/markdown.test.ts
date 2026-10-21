import { describe, expect, it } from "vitest";
import { analyzeBuffer, renderMarkdown } from "@engine/browser";
import { plainWorkbook } from "@/test/fixtures";
import { markdownToHtml } from "./markdown";

describe("markdownToHtml(Worker で仕様書を HTML にする)", () => {
  it("リンク・画像・自動リンクの記法はタグにしない。<br> は残し、mermaid はプレースホルダーにする", () => {
    const { html, diagrams } = markdownToHtml(
      ["# 題", "", "[押して](javascript:alert(1)) ![x](https://evil.example/x.png) https://evil.example", "", "| a |", "| - |", "| 1<br>2 |", "", "```mermaid", "flowchart LR", "  a --> b", "```", "", "```sql", "SELECT 1", "```"].join("\n"),
    );
    expect(html).not.toMatch(/<a\s|<img/i);
    expect(html).toContain("1<br>2");
    expect(html).toContain('<div class="mermaid-src" data-mermaid-index="0"></div>');
    expect(diagrams).toEqual(["flowchart LR\n  a --> b"]);
    expect(html).toContain('<code class="language-sql">SELECT 1');
  });

  it("ファイル由来の文字列(シート名・モジュール名など)はエンジンがエスケープ済みで、タグにならない", () => {
    const report = analyzeBuffer(plainWorkbook(), "売上.xlsm");
    report.excel!.sheets[0].name = '<img src=x onerror="alert(1)">';
    report.vba!.modules[0].name = "<script>alert(1)</script>";
    const { html } = markdownToHtml(renderMarkdown(report));
    expect(html).not.toMatch(/<img|<script/i);
    expect(html).toContain("&lt;img");
  });
});
