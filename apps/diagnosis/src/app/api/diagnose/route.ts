import { calculateDiagnosis } from "@/lib/diagnosis/calculate";
import { generateAiReport, hasAnthropicCredentials } from "@/lib/diagnosis/ai";
import { buildFallbackReport } from "@/lib/diagnosis/fallback";
import { DiagnosisInputSchema } from "@/lib/diagnosis/schema";
import { isRateLimited } from "@/lib/rate-limit";

export const maxDuration = 120;

// 正しい入力は数KBに収まる。これを超える本文は最後まで読まずに断る
const MAX_BODY_BYTES = 32 * 1024;

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (isRateLimited(ip)) {
    return Response.json(
      { error: "診断の回数が上限に達しました。しばらく時間をおいてお試しください。" },
      { status: 429 },
    );
  }

  const text = await readBodyText(request);
  if (text === null) {
    return Response.json({ error: "入力内容が大きすぎます" }, { status: 413 });
  }
  const parsed = DiagnosisInputSchema.safeParse(parseJson(text));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "入力内容に誤りがあります" },
      { status: 400 },
    );
  }

  const result = calculateDiagnosis(parsed.data);

  if (hasAnthropicCredentials()) {
    try {
      const report = await generateAiReport(parsed.data, result);
      return Response.json({ result, report, aiGenerated: true });
    } catch (error) {
      console.error("AIレポートの生成に失敗しました", error);
    }
  }

  return Response.json({
    result,
    report: buildFallbackReport(result),
    aiGenerated: false,
  });
}

/** 本文を MAX_BODY_BYTES まで読む。超えたら null(Content-Length のない分割送信にも対応) */
async function readBodyText(request: Request): Promise<string | null> {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
