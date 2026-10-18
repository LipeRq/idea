import { handle } from "@/lib/http";
import { LIMITS, PipelineError, registerInquiry, type UploadedFile } from "@/lib/pipeline";

// 図面の読み取り(AI)に時間がかかるため長めにする
export const maxDuration = 300;

// 図面の合計上限+メール本文とフォームの区切りの分
const MAX_BODY_BYTES = LIMITS.maxTotalBytes + 512 * 1024;

export async function POST(request: Request) {
  return handle("inquiries.create", async (deps) => {
    if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) {
      throw new PipelineError("図面は合計20MBまでです", 413);
    }
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new PipelineError("入力内容に誤りがあります", 400);
    }
    const text = (key: string) => {
      const v = form.get(key);
      return typeof v === "string" ? v : "";
    };
    const files: UploadedFile[] = [];
    for (const entry of form.getAll("files")) {
      if (typeof entry === "string" || entry.size === 0) continue;
      files.push({ name: entry.name || "drawing.pdf", data: new Uint8Array(await entry.arrayBuffer()) });
    }
    const inquiry = await registerInquiry(deps, {
      email: { from: text("from"), subject: text("subject"), body: text("body") },
      files,
    });
    return Response.json({ id: inquiry.id }, { status: 201 });
  });
}
