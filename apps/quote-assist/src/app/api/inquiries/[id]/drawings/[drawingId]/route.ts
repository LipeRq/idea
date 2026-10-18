import { handle, inquiryId } from "@/lib/http";
import { PipelineError } from "@/lib/pipeline";

// 登録した図面PDFの表示(根拠の確認用)。共有キャッシュには残さない
export async function GET(_request: Request, ctx: { params: Promise<{ id: string; drawingId: string }> }) {
  return handle("drawing.get", async (deps) => {
    const id = await inquiryId(ctx);
    const { drawingId } = await ctx.params;
    const inquiry = await deps.storage.inquiries.get(id);
    const drawing = inquiry?.drawings.find((d) => d.id === drawingId);
    const data = drawing ? await deps.storage.blobs.get(drawing.blobKey) : null;
    if (!drawing || !data) throw new PipelineError("図面が見つかりません", 404);
    return new Response(Buffer.from(data), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(drawing.fileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
