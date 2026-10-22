import { describe, expect, it } from "vitest";
import { calculateDiagnosis } from "@/lib/diagnosis/calculate";
import { buildFallbackReport } from "@/lib/diagnosis/fallback";
import { RELATED_TOOL_REASONS } from "@/lib/diagnosis/related-tools";
import type { DiagnosisInput } from "@/lib/diagnosis/schema";
import { readPdf } from "@/test-utils/pdf";
import { renderReportPdf } from "./pdf";

async function pdfText(input: DiagnosisInput, relatedToolUrls?: Record<string, string>) {
  const result = calculateDiagnosis(input);
  const pdf = await renderReportPdf({
    input,
    result,
    report: buildFallbackReport(result),
    aiGenerated: false,
    issuedAt: new Date("2026-10-22T00:00:00Z"),
    brandName: "AI導入診断",
    relatedToolUrls,
  });
  return (await readPdf(pdf)).compact;
}

const compact = (text: string) => text.replace(/\s+/g, "");

// 製造業・見積書の作成30時間・「いま困っていること」に Excel マクロ → 2つとも案内する
const both: DiagnosisInput = {
  industry: "製造業",
  employees: "11〜30名",
  hourlyCost: 3_000,
  taskHours: { documents: 30 },
  readiness: { dataLocation: 3, manuals: 3, aiUsage: 3, itStaff: 3, rules: 3, leadership: 3 },
  goals: [],
  challenges: "Excelマクロで見積を作っている",
};

describe("PDFの「あわせて使えるツール」", () => {
  it("リンク先が設定されていればリンクを、なければ「無料相談でご案内します」を書く。理由も入る", async () => {
    const text = await pdfText(both, { inventoryTool: "https://inventory.example.com/" });
    for (const expected of [
      "あわせて使えるツール",
      "Excelマクロ・Accessの中身を調べる無料ツール",
      "無料ツールを開く:https://inventory.example.com/",
      "製造業向け見積アシストのデモ(面談で実演)",
      compact(RELATED_TOOL_REASONS.quoteDocumentHours),
      "無料相談でご案内します。",
      "効果を保証するものではありません。",
    ]) {
      expect(text).toContain(expected);
    }
  }, 30_000);

  it("どのルールにも当てはまらなければ節を出さない", async () => {
    const text = await pdfText({ ...both, taskHours: { minutes: 100 }, challenges: undefined });
    expect(text).not.toContain("あわせて使えるツール");
  }, 30_000);
});
