import { z } from "zod";
import { handle, inquiryId, readJson, type RouteContext } from "@/lib/http";
import { recordOutcome } from "@/lib/pipeline";

const BodySchema = z
  .object({
    result: z.enum(["won", "lost"]),
    // 実績原価(税抜・円)。製作が終わるまでは null
    actualCost: z.number().int().min(0).max(1_000_000_000).nullable(),
    reworkCount: z.number().int().min(0).max(999).nullable(),
  })
  .strict();

/** 受注・失注、実績原価、手戻りの記録(効果測定用。承認した見積だけ) */
export async function PUT(request: Request, ctx: RouteContext) {
  return handle("inquiry.outcome", async (deps) => {
    const id = await inquiryId(ctx);
    const body = BodySchema.parse(await readJson(request));
    const inquiry = await recordOutcome(deps, id, body);
    return Response.json({ outcome: inquiry.outcome });
  });
}

export async function DELETE(_request: Request, ctx: RouteContext) {
  return handle("inquiry.outcome.delete", async (deps) => {
    await recordOutcome(deps, await inquiryId(ctx), null);
    return Response.json({ outcome: null });
  });
}
