import { calculateDiagnosis } from "@/lib/diagnosis/calculate";
import { parseJson, readBodyText } from "@idea/shared/http";
import { clientKey, errorResponse } from "@/lib/http";
import { deliverLead } from "@/lib/lead/deliver";
import { LeadRequestSchema, leadFieldErrors } from "@/lib/lead/schema";
import { summarizeDiagnosis } from "@/lib/lead/summary";
import { isLeadRateLimited } from "@/lib/rate-limit";
import { TURNSTILE_ERROR_MESSAGE, isHumanRequest } from "@/lib/turnstile";

export const maxDuration = 30;

// 相談内容(2,000文字)と診断の入力が収まる大きさ
const MAX_BODY_BYTES = 32 * 1024;

export async function POST(request: Request) {
  if (await isLeadRateLimited(clientKey(request))) {
    return errorResponse(
      429,
      "送信の回数が上限に達しました。しばらく時間をおいてお試しください。",
    );
  }

  const text = await readBodyText(request, MAX_BODY_BYTES);
  if (text === null) {
    return errorResponse(413, "送信内容が大きすぎます");
  }
  const body = parseJson(text);

  // ハニーポットに入力があればボットとみなし、送ったふりをして破棄する(エラーで手がかりを与えない)
  if (isHoneypotFilled(body)) {
    console.info("[lead] ハニーポットに入力があったため、申し込みを破棄しました");
    return Response.json({ ok: true });
  }

  const parsed = LeadRequestSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors = leadFieldErrors(parsed.error, ["contact"]);
    return Object.keys(fieldErrors).length > 0
      ? errorResponse(400, "入力内容をご確認ください", { fieldErrors })
      : errorResponse(400, "送信内容を読み取れませんでした。ページを読み込み直してお試しください。");
  }

  if (!(await isHumanRequest(request, "lead"))) {
    return errorResponse(403, TURNSTILE_ERROR_MESSAGE);
  }

  const { contact, input } = parsed.data;
  const outcome = await deliverLead({
    contact: {
      companyName: contact.companyName,
      name: contact.name,
      email: contact.email,
      phone: contact.phone || undefined,
      message: contact.message,
    },
    // 数値はクライアントから送られた結果を使わず、入力から計算し直す
    summary: summarizeDiagnosis(input, calculateDiagnosis(input)),
    submittedAt: new Date(),
  });

  if (outcome === "sent") return Response.json({ ok: true });
  if (outcome === "not_configured") {
    return errorResponse(503, "現在、フォームからのお申し込みを受け付けられません。");
  }
  return errorResponse(502, "送信に失敗しました。時間をおいてもう一度お試しください。");
}

function isHoneypotFilled(body: unknown): boolean {
  if (body === null || typeof body !== "object" || !("website" in body)) return false;
  const value = (body as { website: unknown }).website;
  return typeof value !== "string" || value.trim() !== "";
}
