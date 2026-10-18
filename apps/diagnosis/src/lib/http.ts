// Route Handler で共通に使う、リクエストの読み取りと応答のヘルパー。

/** 回数制限のキーにする送信元。リバースプロキシが付ける x-forwarded-for の先頭を使う */
export function clientKey(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** 本文を maxBytes まで読む。超えたら null(Content-Length のない分割送信にも対応) */
export async function readBodyText(
  request: Request,
  maxBytes: number,
): Promise<string | null> {
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

export function errorResponse(status: number, error: string, extra?: object): Response {
  return Response.json({ error, ...extra }, { status });
}
