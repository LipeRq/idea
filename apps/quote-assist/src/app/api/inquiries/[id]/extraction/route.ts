import { ExtractionEditsSchema } from "@/lib/extraction/edit";
import { handle, inquiryId, readJson, type RouteContext } from "@/lib/http";
import { updateExtraction } from "@/lib/pipeline";

export async function PATCH(request: Request, ctx: RouteContext) {
  return handle("extraction.update", async (deps) => {
    const id = await inquiryId(ctx);
    const edits = ExtractionEditsSchema.parse(await readJson(request));
    const inquiry = await updateExtraction(deps, id, edits);
    return Response.json({ status: inquiry.status, questions: inquiry.extraction.questions.length });
  });
}
