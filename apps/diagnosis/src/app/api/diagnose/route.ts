import { reserveAiCall } from "@/lib/ai-quota";
import { calculateDiagnosis } from "@/lib/diagnosis/calculate";
import { generateAiReport, hasAnthropicCredentials } from "@/lib/diagnosis/ai";
import { buildFallbackReport } from "@/lib/diagnosis/fallback";
import { DiagnosisInputSchema } from "@/lib/diagnosis/schema";
import type { DiagnosisResponse, FallbackReason } from "@/lib/diagnosis/types";
import { clientKey, errorResponse, parseJson, readBodyText } from "@/lib/http";
import { isDiagnoseRateLimited } from "@/lib/rate-limit";
import { signReport } from "@/lib/report/token";
import { TURNSTILE_ERROR_MESSAGE, isHumanRequest } from "@/lib/turnstile";

export const maxDuration = 120;

// 正しい入力は数KBに収まる。これを超える本文は最後まで読まずに断る
const MAX_BODY_BYTES = 32 * 1024;

export async function POST(request: Request) {
  if (await isDiagnoseRateLimited(clientKey(request))) {
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

  // 入力の検証のあとに確かめる(誤った入力でトークンを使い切らない)
  if (!(await isHumanRequest(request, "diagnose"))) {
    return errorResponse(403, TURNSTILE_ERROR_MESSAGE);
  }

  const result = calculateDiagnosis(parsed.data);
  let fallbackReason: FallbackReason | undefined;

  if (hasAnthropicCredentials()) {
    if (await reserveAiCall()) {
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
    } else {
      // 1日の上限(AI_DAILY_LIMIT)に達したら、AIを呼ばずに標準レポートで返す
      fallbackReason = "daily_limit";
    }
  }

  return Response.json({
    result,
    report: buildFallbackReport(result),
    aiGenerated: false,
    ...(fallbackReason && { fallbackReason }),
  } satisfies DiagnosisResponse);
}
