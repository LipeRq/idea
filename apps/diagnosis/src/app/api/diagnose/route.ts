import { calculateDiagnosis } from "@/lib/diagnosis/calculate";
import { generateAiReport, hasAnthropicCredentials } from "@/lib/diagnosis/ai";
import { buildFallbackReport } from "@/lib/diagnosis/fallback";
import { DiagnosisInputSchema } from "@/lib/diagnosis/schema";
import type { DiagnosisResponse } from "@/lib/diagnosis/types";
import { clientKey, errorResponse, parseJson, readBodyText } from "@/lib/http";
import { isDiagnoseRateLimited } from "@/lib/rate-limit";
import { signReport } from "@/lib/report/token";

export const maxDuration = 120;

// 正しい入力は数KBに収まる。これを超える本文は最後まで読まずに断る
const MAX_BODY_BYTES = 32 * 1024;

export async function POST(request: Request) {
  if (isDiagnoseRateLimited(clientKey(request))) {
    return errorResponse(
      429,
      "診断の回数が上限に達しました。しばらく時間をおいてお試しください。",
    );
  }

  const text = await readBodyText(request, MAX_BODY_BYTES);
  if (text === null) {
    return errorResponse(413, "入力内容が大きすぎます");
  }
  const parsed = DiagnosisInputSchema.safeParse(parseJson(text));
  if (!parsed.success) {
    return errorResponse(400, parsed.error.issues[0]?.message ?? "入力内容に誤りがあります");
  }

  const result = calculateDiagnosis(parsed.data);

  if (hasAnthropicCredentials()) {
    try {
      const report = await generateAiReport(parsed.data, result);
      return Response.json({
        result,
        report,
        aiGenerated: true,
        reportToken: signReport(parsed.data, report),
      } satisfies DiagnosisResponse);
    } catch (error) {
      console.error("AIレポートの生成に失敗しました", error);
    }
  }

  return Response.json({
    result,
    report: buildFallbackReport(result),
    aiGenerated: false,
  } satisfies DiagnosisResponse);
}
