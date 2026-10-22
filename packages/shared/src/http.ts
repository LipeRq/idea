// Route Handler で共通に使う、リクエストの読み取りのヘルパー(サーバー専用)。

/** 送信元が分からないときのキー(全員で1つの枠を共有する) */
export const SHARED_CLIENT_KEY = "shared";

/**
 * 回数制限のキーにする送信元を返す関数を作る。利用者が偽装できない値だけを使う。
 * - Vercel 上: Vercel が付ける x-vercel-forwarded-for(利用者が送った値は Vercel が上書きする)
 * - <trustProxyEnv>=true(手前に信頼できるリバースプロキシが1段ある): x-forwarded-for の末尾(そのプロキシが付けた値)
 * - それ以外(next start を直接公開しているなど): 転送元のヘッダーは偽装できるので使わず、全員で1つの枠を共有する
 *   (x-forwarded-for の先頭は利用者が自由に書けるので、毎回変えれば回数制限をすり抜けられる)
 *
 * @param trustProxyEnv アプリごとの環境変数名(例: DIAGNOSIS_TRUST_PROXY)
 */
export function createClientKey(trustProxyEnv: string): (request: Request, env?: NodeJS.ProcessEnv) => string {
  return (request, env = process.env) => {
    if (env.VERCEL?.trim()) {
      const v = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
      if (v) return v;
    }
    if (env[trustProxyEnv]?.trim() === "true") {
      const v = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
      if (v) return v;
    }
    return SHARED_CLIENT_KEY;
  };
}

/**
 * 本文を maxBytes まで読む。超えたら null。
 * Content-Length のない(chunked)要求でも、上限を超えた時点で読むのをやめる
 * (request.text() や request.formData() は本文を最後まで読み込んでしまうため、大きな要求でメモリを使い切る)。
 */
export async function readBodyBytes(request: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (Number(request.headers.get("content-length")) > maxBytes) return null;
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
      return null;
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

/** 本文を maxBytes まで読み、UTF-8 の文字列にする。超えたら null */
export async function readBodyText(request: Request, maxBytes: number): Promise<string | null> {
  const body = await readBodyBytes(request, maxBytes);
  return body === null ? null : new TextDecoder().decode(body);
}

/** JSON として読めなければ null */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
