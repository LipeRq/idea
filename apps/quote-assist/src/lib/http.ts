import { ZodError } from "zod";
import { getDeps, type Deps } from "./deps";
import { logError } from "./log";
import { PipelineError } from "./pipeline";

// Route Handler の共通処理。想定内のエラーは定型文とステータスで返し、上流のエラー内容は返さない。

export type RouteContext = { params: Promise<{ id: string }> };

const ID = /^[0-9a-f-]{36}$/;

export async function inquiryId(ctx: RouteContext): Promise<string> {
  const { id } = await ctx.params;
  if (!ID.test(id)) throw new PipelineError("引き合いが見つかりません", 404);
  return id;
}

export async function handle(name: string, fn: (deps: Deps) => Promise<Response>): Promise<Response> {
  try {
    return await fn(getDeps());
  } catch (error) {
    if (error instanceof PipelineError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof ZodError) {
      return Response.json({ error: "入力内容に誤りがあります" }, { status: 400 });
    }
    logError(`${name}.error`, error);
    return Response.json({ error: "処理に失敗しました。時間をおいてもう一度お試しください。" }, { status: 500 });
  }
}

/**
 * 本文を上限つきで読む。Content-Length がない(chunked)要求でも、上限を超えた時点で読むのをやめて413にする
 * (request.text() や request.formData() は本文を最後まで読み込んでしまうため、大きな要求でメモリを使い切る)。
 */
export async function readBodyLimited(request: Request, maxBytes: number, message = "入力内容が大きすぎます"): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(request.headers.get("content-length")) > maxBytes) throw new PipelineError(message, 413);
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new PipelineError(message, 413);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** JSONの本文を上限つきで読む */
export async function readJson(request: Request, maxBytes = 64 * 1024): Promise<unknown> {
  const text = new TextDecoder().decode(await readBodyLimited(request, maxBytes));
  try {
    return JSON.parse(text);
  } catch {
    throw new PipelineError("入力内容に誤りがあります", 400);
  }
}
