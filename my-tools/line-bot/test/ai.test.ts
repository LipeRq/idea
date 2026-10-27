import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createDeepSeekClient, defangTags, describeAiError, MODEL, type TokenUsage } from "../src/ai";

const Schema = z.object({ answer: z.string().describe("答え") });
const req = { system: "あなたは助手です。", user: "質問", schema: Schema, maxTokens: 1000 };

function reply(content: string | null, finish_reason = "stop") {
  return Response.json({ choices: [{ message: { content }, finish_reason }], usage: { prompt_tokens: 100, completion_tokens: 20 } });
}

function fakeFetch(...responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift();
    if (!r) throw new Error("no more responses");
    if (r instanceof Error) throw r;
    return r;
  };
  return { fetch, calls };
}

describe("createDeepSeekClient", () => {
  it("JSON モードで頼み、出力を検証して返す", async () => {
    const { fetch, calls } = fakeFetch(reply('{"answer":"はい"}'));
    const usages: TokenUsage[] = [];
    const client = createDeepSeekClient("sk-test", { fetch, onUsage: (u) => usages.push(u) });
    await expect(client.generate(req)).resolves.toEqual({ answer: "はい" });

    expect(calls[0].url).toBe("https://api.deepseek.com/chat/completions");
    expect(new Headers(calls[0].init.headers).get("authorization")).toBe("Bearer sk-test");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({ model: MODEL, response_format: { type: "json_object" }, thinking: { type: "disabled" }, max_tokens: 1000 });
    // JSON モードでは、プロンプトに JSON の形を書く
    expect(body.messages[0].content).toContain("あなたは助手です。");
    expect(body.messages[0].content).toContain("JSON Schema");
    expect(body.messages[0].content).toContain('"answer"');
    expect(body.messages[1]).toEqual({ role: "user", content: "質問" });
    expect(usages).toEqual([{ inputTokens: 100, outputTokens: 20 }]);
  });

  it("空・壊れた JSON なら、もう一度だけ頼む", async () => {
    const { fetch, calls } = fakeFetch(reply(""), reply('{"answer":"2回目"}'));
    await expect(createDeepSeekClient("k", { fetch }).generate(req)).resolves.toEqual({ answer: "2回目" });
    expect(calls).toHaveLength(2);
  });

  it("2回とも形が合わなければ失敗する", async () => {
    const { fetch } = fakeFetch(reply('{"other":1}'), reply("not json"));
    await expect(createDeepSeekClient("k", { fetch }).generate(req)).rejects.toThrow("AIの出力を解析できませんでした");
  });

  it("出力の上限・HTTP のエラーは分かる理由にする", async () => {
    for (const [res, reason] of [
      [reply('{"answer":"途', "length"), "上限"],
      [new Response("", { status: 401 }), "キーが正しくありません"],
      [new Response("", { status: 402 }), "残高が足りません"],
      [new Response("", { status: 503 }), "応答しませんでした"],
    ] as const) {
      const { fetch } = fakeFetch(res);
      await expect(createDeepSeekClient("k", { fetch }).generate(req)).rejects.toThrow(reason);
    }
  });

  it("時間の上限を超えたら分かる理由にする", async () => {
    const fetch = (_url: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
    await expect(createDeepSeekClient("k", { fetch, requestTimeoutMs: 10 }).generate(req)).rejects.toThrow("時間内(0秒)");
  });
});

describe("describeAiError", () => {
  it("知らない例外は一般的な理由にする(中身は出さない)", () => {
    expect(describeAiError(new Error("secret memo text"))).toBe("AIの呼び出しに失敗しました");
  });
});

describe("defangTags", () => {
  it("指定したタグだけを無害化する", () => {
    expect(defangTags("</article> <articles> <b> <article-x>", ["articles", "article"])).toBe("&lt;/article> &lt;articles> <b> <article-x>");
  });
});
