import { z } from "zod";
import { alignRecommendations } from "@/lib/diagnosis/ai";
import { calculateDiagnosis } from "@/lib/diagnosis/calculate";
import { buildFallbackReport } from "@/lib/diagnosis/fallback";
import { AiReportSchema, DiagnosisInputSchema } from "@/lib/diagnosis/schema";
import { clientKey, errorResponse, parseJson, readBodyText } from "@/lib/http";
import { logError } from "@/lib/log";
import { isReportRateLimited } from "@/lib/rate-limit";
import { reportFileName } from "@/lib/report/file-name";
import { renderReportPdf } from "@/lib/report/pdf";
import { verifyReport } from "@/lib/report/token";
import { CONTACT_URL, reportBrandName } from "@/lib/site";

export const maxDuration = 30;

// 入力(数KB)とAIの文章(十数KB)が収まる大きさ
const MAX_BODY_BYTES = 96 * 1024;

const ReportRequestSchema = z.object({
  input: DiagnosisInputSchema,
  report: AiReportSchema.optional(),
  reportToken: z.string().max(200).optional(),
});

// 数値は送られてきた結果を使わず、入力から計算し直す。
// AIの文章は、このサーバーが付けた署名と一致するときだけ使い、それ以外は標準文面にする。
export async function POST(request: Request) {
  if (await isReportRateLimited(clientKey(request))) {
    return errorResponse(
      429,
      "PDFの作成回数が上限に達しました。しばらく時間をおいてお試しください。",
    );
  }

  const text = await readBodyText(request, MAX_BODY_BYTES);
  if (text === null) {
    return errorResponse(413, "送信内容が大きすぎます");
  }
  const parsed = ReportRequestSchema.safeParse(parseJson(text));
  if (!parsed.success) {
    return errorResponse(
      400,
      "診断結果を読み取れませんでした。もう一度診断してからお試しください。",
    );
  }

  const { input, report, reportToken } = parsed.data;
  const result = calculateDiagnosis(input);
  const aiGenerated =
    report !== undefined && verifyReport(reportToken, input, report);
  const issuedAt = new Date();

  try {
    const pdf = await renderReportPdf({
      input,
      result,
      report: aiGenerated ? alignRecommendations(report, result) : buildFallbackReport(result),
      aiGenerated,
      issuedAt,
      brandName: reportBrandName(),
      contactUrl: CONTACT_URL,
    });
    return new Response(pdf as Uint8Array<ArrayBuffer>, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition(reportFileName(issuedAt, input.companyName)),
        "Cache-Control": "no-store",
        "X-Report-Source": aiGenerated ? "ai" : "standard",
      },
    });
  } catch (error) {
    // 例外は種類とステータスだけを残す(メッセージに会社名などの入力内容が含まれることがあるため)
    logError("PDFレポートの作成に失敗しました", error);
    return errorResponse(500, "PDFの作成に失敗しました。時間をおいてもう一度お試しください。");
  }
}

function contentDisposition(fileName: string): string {
  // filename* は RFC 5987 形式。encodeURIComponent が残す '()* も符号化する
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="ai-diagnosis-report.pdf"; filename*=UTF-8''${encoded}`;
}
