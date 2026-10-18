import { z } from "zod";
import { handle, inquiryId, readJson, type RouteContext } from "@/lib/http";
import { approveQuote, unapproveQuote } from "@/lib/pipeline";

const BodySchema = z.object({ approver: z.string().trim().min(1).max(50) });

/** 承認(人の操作)。承認するとCRMに登録できるようになる */
export async function POST(request: Request, ctx: RouteContext) {
  return handle("quote.approve", async (deps) => {
    const id = await inquiryId(ctx);
    const { approver } = BodySchema.parse(await readJson(request));
    const inquiry = await approveQuote(deps, id, approver);
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
