import { handle, inquiryId, type RouteContext } from "@/lib/http";
import { runEstimate } from "@/lib/pipeline";

export const maxDuration = 300;

export async function POST(_request: Request, ctx: RouteContext) {
  return handle("estimate.run", async (deps) => {
    const inquiry = await runEstimate(deps, await inquiryId(ctx));
    return Response.json({ status: inquiry.status, similar: inquiry.similar?.cases.length ?? 0 });
  });
}
