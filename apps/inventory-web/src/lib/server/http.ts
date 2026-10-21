// Route Handler で共通に使う、リクエストの読み取りと応答のヘルパー(apps/diagnosis の src/lib/http.ts をもとにしている)。

/**
 * 回数制限のキーにする送信元。利用者が偽装できない値だけを使う。
 * - Vercel 上: Vercel が付ける x-vercel-forwarded-for(利用者が送った値は Vercel が上書きする)
 * - INVENTORY_TRUST_PROXY=true(手前に信頼できるリバースプロキシが1段ある): x-forwarded-for の末尾(そのプロキシが付けた値)
 * - それ以外(next start を直接公開しているなど): 転送元のヘッダーは偽装できるので使わず、全員で1つの枠を共有する
 */
export function clientKey(request: Request, env: NodeJS.ProcessEnv = process.env): string {
  if (env.VERCEL?.trim()) {
    const v = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
    if (v) return v;
  }
  if (env.INVENTORY_TRUST_PROXY?.trim() === "true") {
    const v = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
    if (v) return v;
  }
  return "shared";
}

/** 本文を maxBytes まで読む。超えたら null(Content-Length のない分割送信も途中で打ち切る) */
export async function readBodyText(request: Request, maxBytes: number): Promise<string | null> {
  if (Number(request.headers.get("content-length")) > maxBytes) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const NO_STORE = { "Cache-Control": "no-store" };

export function errorResponse(status: number, code: string, error: string): Response {
  return Response.json({ error, code }, { status, headers: NO_STORE });
}
