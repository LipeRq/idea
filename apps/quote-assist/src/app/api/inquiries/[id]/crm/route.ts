import { handle, inquiryId, type RouteContext } from "@/lib/http";
import { registerToCrm } from "@/lib/pipeline";

export async function POST(_request: Request, ctx: RouteContext) {
  return handle("crm.register", async (deps) => {
    const inquiry = await registerToCrm(deps, await inquiryId(ctx));
    return Response.json({ status: inquiry.status, crm: inquiry.crm });
  });
}
