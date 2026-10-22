import { connection } from "next/server";
import { baselineToCsv, baselineTemplateCsv } from "@/lib/impact/baseline-csv";
import { handle } from "@/lib/http";
import { loadBaseline, loadImpactView, parseGranularity, parseSource } from "@/lib/impact/load";
import { adoptionCsv, reportMarkdown, summaryCsv, trendCsv } from "@/lib/impact/report";

const PARTS = ["summary", "trend", "adoption", "baseline", "template"] as const;
type Part = (typeof PARTS)[number];

function download(body: string, filename: string, type: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": `${type}; charset=utf-8`,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * 効果測定の書き出し。
 *   ?format=md                      報告書(Markdown)
 *   ?format=csv&part=summary        導入前後の比較(既定)
 *   ?format=csv&part=trend|adoption|baseline|template
 * 集計の条件は ?g=week|month と ?source=demo|app(画面と同じ)
 */
export async function GET(request: Request) {
  // 保存データは要求ごとに読む(事前レンダリングに含めない)。request.url を読む前に動的にする
  await connection();
  return handle("impact.export", async (deps) => {
    const url = new URL(request.url);
    const format = url.searchParams.get("format") === "md" ? "md" : "csv";
    const partParam = url.searchParams.get("part") ?? "summary";
    const part: Part = (PARTS as readonly string[]).includes(partParam) ? (partParam as Part) : "summary";

    if (format === "csv" && part === "template") return download(baselineTemplateCsv(), "baseline-template.csv", "text/csv");
    if (format === "csv" && part === "baseline") {
      const { baseline } = await loadBaseline(deps);
      return download(baselineToCsv(baseline?.rows ?? []), "baseline.csv", "text/csv");
    }

    const view = await loadImpactView(deps, {
      source: parseSource(url.searchParams.get("source") ?? undefined),
      granularity: parseGranularity(url.searchParams.get("g") ?? undefined),
    });
    const date = view.report.generatedOn;
    if (format === "md") return download(reportMarkdown(view.report), `quote-assist-impact-${date}.md`, "text/markdown");
    const csv = part === "trend" ? trendCsv(view.report) : part === "adoption" ? adoptionCsv(view.report) : summaryCsv(view.report);
    return download(csv, `quote-assist-impact-${part}-${date}.csv`, "text/csv");
  });
}
