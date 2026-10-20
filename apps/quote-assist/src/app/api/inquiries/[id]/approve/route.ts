import { z } from "zod";
import { handle, inquiryId, readJson, type RouteContext } from "@/lib/http";
import { approveQuote, unapproveQuote } from "@/lib/pipeline";

const BodySchema = z
  .object({
    approver: z.string().trim().min(1).max(50),
    // 承認者が画面で見た合計金額(税抜)。今の単価表での計算結果と違えば承認しない
    expectedTotal: z.number().int().min(0),
    // 抽出結果の要確認・不足の項目を確認したか(残っているときは true でないと承認しない)
    acknowledgeUnconfirmed: z.boolean().default(false),
  })
  .strict();

/** 承認(人の操作)。承認するとCRMに登録できるようになる */
export async function POST(request: Request, ctx: RouteContext) {
  return handle("quote.approve", async (deps) => {
    const id = await inquiryId(ctx);
    const { approver, ...options } = BodySchema.parse(await readJson(request));
    const inquiry = await approveQuote(deps, id, approver, options);
    return Response.json({ status: inquiry.status, total: inquiry.approved?.total });
  });
}

/** 承認の取り消し(CRM登録前のみ) */
export async function DELETE(_request: Request, ctx: RouteContext) {
  return handle("quote.unapprove", async (deps) => {
    const inquiry = await unapproveQuote(deps, await inquiryId(ctx));
    return Response.json({ status: inquiry.status });
  });
}
