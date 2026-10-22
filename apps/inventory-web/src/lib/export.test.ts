import { describe, expect, it } from "vitest";
import { exportFileName, safeFileStem, standaloneHtml, STANDALONE_CSP } from "./export";

describe("保存するファイルの名前", () => {
  it("使えない文字と制御文字を _ にし、日本語は残す", () => {
    expect(safeFileStem('売上:管理*"2024"?.xlsm')).toBe("売上_管理__2024__");
    expect(safeFileStem("C:\\共有\\台帳.accdb")).toBe("台帳");
    expect(safeFileStem("a\u0001b<c>|d.xls")).toBe("a_b_c__d");
    expect(safeFileStem(".xlsm")).toBe(".xlsm");
    expect(safeFileStem("")).toBe("ファイル");
  });

  it("種類ごとの名前", () => {
    expect(exportFileName("売上管理.xlsm", "html")).toBe("売上管理_棚卸し.html");
    expect(exportFileName("売上管理.xlsm", "markdown")).toBe("売上管理_棚卸し.md");
    expect(exportFileName("売上管理.xlsm", "json")).toBe("売上管理_抽出結果.json");
    expect(exportFileName("売上管理.xlsm", "aiMarkdown")).toBe("売上管理_仕様書_AI.md");
    expect(exportFileName("売上管理.xlsm", "aiPayload")).toBe("売上管理_AI送信内容.json");
    expect(exportFileName("", "listCsv")).toBe("棚卸し一覧.csv");
    expect(exportFileName("", "listHtml")).toBe("棚卸し一覧.html");
    expect(exportFileName("", "listMarkdown")).toBe("棚卸し一覧.md");
  });
});

describe("単体の HTML", () => {
  it("スクリプトを含まず、外部を読みに行かない CSP の meta があり、題名はエスケープする", () => {
    const html = standaloneHtml("棚卸しレポート: <script>alert(1)</script>.xlsm", "<h1>本文</h1>");
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${STANDALONE_CSP}">`);
    expect(STANDALONE_CSP).toContain("default-src 'none'");
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("<title>棚卸しレポート: &lt;script&gt;alert(1)&lt;/script&gt;.xlsm</title>");
    expect(html).toContain('<html lang="ja">');
  });
});
