// AI 版の受付。処理の中身は src/lib/server/ai-document.ts(単体テストはそちらを直接呼ぶ)。
import { connection } from "next/server";
import { aiConfigFromEnv, aiStatusBody } from "@/lib/server/ai-config";
import { AI_DEADLINE_MS, handleAiDocumentPost } from "@/lib/server/ai-document";
import { NO_STORE } from "@/lib/server/http";

// 生成には数分かかることがある(要約の依頼を並べて出し、最後に全体を統合する)。デプロイ先の上限に合わせて調整する
export const maxDuration = 300;

export async function GET() {
  // Cache Components では、実行時のデータに触れない GET はビルド時に事前生成されて値が固定される。
  // 環境変数で AI 版を止める・有効にする操作が再ビルドなしで効くよう、リクエストのたびに実行する
  await connection();
  return Response.json(aiStatusBody(aiConfigFromEnv()), { headers: NO_STORE });
}

export async function POST(request: Request) {
  // 利用者の中止と、maxDuration より前の全体の上限(AI_DEADLINE_MS)のどちらかで AI への依頼を止める
  return handleAiDocumentPost(request, { signal: AbortSignal.any([request.signal, AbortSignal.timeout(AI_DEADLINE_MS)]) });
}
