import { describe, expect, it } from "vitest";
import { createClientKey, parseJson, readBodyBytes, readBodyText, SHARED_CLIENT_KEY } from "./http";

const request = (headers: Record<string, string>) => new Request("http://localhost/api/x", { headers });

describe("createClientKey(回数制限の送信元)", () => {
  const clientKey = createClientKey("APP_TRUST_PROXY");
  const headers = { "x-forwarded-for": "198.51.100.7, 203.0.113.1", "x-vercel-forwarded-for": "203.0.113.9" };

  it("Vercel 上では x-vercel-forwarded-for を使う", () => {
    expect(clientKey(request(headers), { NODE_ENV: "test", VERCEL: "1" })).toBe("203.0.113.9");
  });

  it("アプリの環境変数(<名前>=true)のときだけ x-forwarded-for の末尾(信頼するプロキシが付けた値)を使う", () => {
    expect(clientKey(request(headers), { NODE_ENV: "test", APP_TRUST_PROXY: "true" })).toBe("203.0.113.1");
    // 別のアプリの環境変数では信頼しない
    expect(clientKey(request(headers), { NODE_ENV: "test", OTHER_TRUST_PROXY: "true" })).toBe(SHARED_CLIENT_KEY);
  });

  it("それ以外は偽装できるヘッダーを使わず、全員で1つの枠を共有する", () => {
    expect(clientKey(request(headers), { NODE_ENV: "test" })).toBe(SHARED_CLIENT_KEY);
    expect(clientKey(request({}), { NODE_ENV: "test", VERCEL: "1", APP_TRUST_PROXY: "true" })).toBe(SHARED_CLIENT_KEY);
  });
});

/** Content-Length を付けずに、分割して送る本文 */
function chunked(chunks: Uint8Array[]): Request {
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(chunks[i++]);
      else controller.close();
    },
  });
  return new Request("http://localhost/api/x", { method: "POST", body, duplex: "half" } as RequestInit);
}

describe("readBodyBytes・readBodyText", () => {
  it("上限以内なら全部を返す(分割された UTF-8 の文字も正しくつなぐ)", async () => {
    const bytes = new TextEncoder().encode("見積もり");
    const req = () => chunked([bytes.slice(0, 4), bytes.slice(4)]);
    expect(await readBodyText(req(), 100)).toBe("見積もり");
    expect(Array.from((await readBodyBytes(req(), 100)) ?? [])).toEqual(Array.from(bytes));
  });

  it("Content-Length が上限を超えていれば、読まずに null", async () => {
    const req = new Request("http://localhost/api/x", { method: "POST", body: "x".repeat(20), headers: { "content-length": "20" } });
    expect(await readBodyText(req, 10)).toBeNull();
  });

  it("Content-Length が無くても、上限を超えた時点で読むのをやめて null", async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(8));
      },
    });
    const req = new Request("http://localhost/api/x", { method: "POST", body, duplex: "half" } as RequestInit);
    expect(await readBodyBytes(req, 20)).toBeNull();
    expect(pulled).toBeLessThan(10);
  });

  it("本文が無ければ空", async () => {
    expect(await readBodyText(new Request("http://localhost/api/x"), 10)).toBe("");
    expect((await readBodyBytes(new Request("http://localhost/api/x"), 10))?.byteLength).toBe(0);
  });
});

describe("parseJson", () => {
  it("JSON として読めなければ null", () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseJson("{")).toBeNull();
  });
});
