import { afterEach, describe, expect, it, vi } from "vitest";
import { MOCK_OVERALL } from "@/lib/server/mock-client";
import { AiRequestError, fetchAiStatus, requestAiDocument } from "./ai-client";

const AI = { modules: {}, overall: MOCK_OVERALL, notes: [] };

function streamOf(chunks: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("requestAiDocument", () => {
  it("行の途中で分割された NDJSON を読み、進捗を伝え、done を検証して返す", async () => {
    const done = JSON.stringify({ type: "done", ai: AI });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(streamOf(['{"type":"accepted","batches":1}\n{"type":"progr', 'ess","message":"要約 1/1"}\n{"type":"heartbeat"}\n', done.slice(0, 20), done.slice(20)]), {
        headers: { "content-type": "application/x-ndjson" },
      })),
    );
    const progress: string[] = [];
    const ai = await requestAiDocument({ body: "{}", onProgress: (m) => progress.push(m) });
    expect(progress).toEqual(["要約 1/1"]);
    expect(ai.overall.overview).toBe(MOCK_OVERALL.overview);
  });

  it("JSON でない応答(プラットフォームの 413・504 の HTML)も文言にする", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Request Entity Too Large</html>", { status: 413 })));
    await expect(requestAiDocument({ body: "{}" })).rejects.toMatchObject({ code: "too_large" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>timeout</html>", { status: 504 })));
    await expect(requestAiDocument({ body: "{}" })).rejects.toMatchObject({ code: "unavailable" });
  });

  it("サーバーの JSON のエラーは、その文言を使う。古い同意の版は再読み込みを案内する", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "アクセスコードが違います。", code: "forbidden" }, { status: 403 })));
    await expect(requestAiDocument({ body: "{}" })).rejects.toMatchObject({ code: "forbidden", message: "アクセスコードが違います。" });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "x", code: "consent_outdated" }, { status: 409 })));
    await expect(requestAiDocument({ body: "{}" })).rejects.toThrow("再読み込み");
  });

  it("error イベント・形の違う done・途中で切れた応答はエラーにする", async () => {
    const ndjson = (text: string) => vi.fn(async () => new Response(streamOf([text]), { headers: { "content-type": "application/x-ndjson" } }));
    vi.stubGlobal("fetch", ndjson('{"type":"error","message":"APIに接続できませんでした"}\n'));
    await expect(requestAiDocument({ body: "{}" })).rejects.toMatchObject({ code: "ai_error", message: "APIに接続できませんでした" });
    vi.stubGlobal("fetch", ndjson('{"type":"done","ai":{"modules":1}}\n'));
    await expect(requestAiDocument({ body: "{}" })).rejects.toMatchObject({ code: "bad_response" });
    vi.stubGlobal("fetch", ndjson('{"type":"accepted","batches":1}\n'));
    await expect(requestAiDocument({ body: "{}" })).rejects.toBeInstanceOf(AiRequestError);
  });

  it("アクセスコードはヘッダーで送る(日本語も送れるようにエンコードする)", async () => {
    const fetchMock = vi.fn(async (...args: [string, RequestInit]) => {
      void args;
      return Response.json({ error: "x", code: "forbidden" }, { status: 403 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await requestAiDocument({ body: "{}", accessCode: "コード" }).catch(() => undefined);
    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-Access-Code"]).toBe(encodeURIComponent("コード"));
  });
});

describe("fetchAiStatus", () => {
  it("形が違う・取得できないときは null(AI のボタンを出さない)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ available: "yes" })));
    expect(await fetchAiStatus()).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    expect(await fetchAiStatus()).toBeNull();
  });
});
