import { handle, inquiryId, readJson, type RouteContext } from "@/lib/http";
import { saveQuote } from "@/lib/pipeline";
import { QuoteInputSchema } from "@/lib/quote/types";

export async function PUT(request: Request, ctx: RouteContext) {
  return handle("quote.save", async (deps) => {
    const id = await inquiryId(ctx);
    const input = QuoteInputSchema.parse(await readJson(request));
    const inquiry = await saveQuote(deps, id, input);
    return Response.json({ status: inquiry.status, changes: inquiry.reviewLog.length });
  });
}
