import { handle, inquiryId, type RouteContext } from "@/lib/http";
import { deleteInquiry } from "@/lib/pipeline";

export async function DELETE(_request: Request, ctx: RouteContext) {
  return handle("inquiries.delete", async (deps) => {
    await deleteInquiry(deps, await inquiryId(ctx));
    return new Response(null, { status: 204 });
  });
}
