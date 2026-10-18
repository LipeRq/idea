import { describe, expect, it } from "vitest";
import { fileNameFromDisposition, reportFileName } from "./file-name";

// 2026-10-18 23:30 JST(UTCでは同日14:30)
const issuedAt = new Date("2026-10-18T14:30:00Z");

describe("reportFileName", () => {
  it("会社名と発行日(日本時間)を入れる", () => {
    expect(reportFileName(issuedAt, "テスト工業")).toBe("AI導入診断レポート_テスト工業_20261018.pdf");
    // 日本時間では翌日
    expect(reportFileName(new Date("2026-10-18T15:30:00Z"))).toBe("AI導入診断レポート_20261019.pdf");
  });

  it("ファイル名に使えない文字・制御文字を除き、40文字で切る", () => {
    expect(reportFileName(issuedAt, 'A/B\\C:D*E?F"G<H>I|J\u0001K')).toBe(
      "AI導入診断レポート_ABCDEFGHIJK_20261018.pdf",
    );
    expect(reportFileName(issuedAt, "あ".repeat(60))).toBe(
      `AI導入診断レポート_${"あ".repeat(40)}_20261018.pdf`,
    );
    expect(reportFileName(issuedAt, " / ")).toBe("AI導入診断レポート_20261018.pdf");
  });
});

describe("fileNameFromDisposition", () => {
  it("filename* を取り出してデコードする", () => {
    const name = "AI導入診断レポート_(株)テスト_20261018.pdf";
    const header = `attachment; filename="ai-diagnosis-report.pdf"; filename*=UTF-8''${encodeURIComponent(name)}`;
    expect(fileNameFromDisposition(header)).toBe(name);
  });

  it("取り出せなければ null", () => {
    expect(fileNameFromDisposition(null)).toBeNull();
    expect(fileNameFromDisposition('attachment; filename="a.pdf"')).toBeNull();
    expect(fileNameFromDisposition("attachment; filename*=UTF-8''%E0%A4%A")).toBeNull();
  });
});
