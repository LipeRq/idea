import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AiGenerationError, createClaudeClient, defangTags, describeAiError, type TokenUsage } from "../src/claude";
import { MODEL } from "../src/model";

const Schema = z.object({ answer: z.string() });

type FakeMessage = { stop_reason: string; content: { type: string; text?: string }[]; usage: { input_tokens: number; output_tokens: number } };

function fakeAnthropic(message: FakeMessage | (() => Promise<FakeMessage>)) {
  const params: Record<string, unknown>[] = [];
  const anthropic = {
    beta: {
      messages: {
        stream(p: Record<string, unknown>) {
          params.push(p);
          return { finalMessage: typeof message === "function" ? message : async () => message };
        },
      },
    },
  } as unknown as Anthropic;
  return { anthropic, params };
}

const ok = (text: string, stop_reason = "end_turn"): FakeMessage => ({ stop_reason, content: [{ type: "text", text }], usage: { input_tokens: 100, output_tokens: 20 } });

describe("createClaudeClient", () => {
  const req = { system: "s", user: "u", schema: Schema, maxTokens: 1000, effort: "low" as const };

  it("構造化出力とサーバー側フォールバックを指定し、出力を検証して返す", async () => {
    const { anthropic, params } = fakeAnthropic(ok('{"answer":"はい"}'));
    const usages: TokenUsage[] = [];
    const client = createClaudeClient(anthropic, { onUsage: (u) => usages.push(u) });
    await expect(client.generate(req)).resolves.toEqual({ answer: "はい" });
    expect(params[0]).toMatchObject({
      model: MODEL,
      max_tokens: 1000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema" } },
      messages: [{ role: "user", content: "u" }],
    });
    expect(usages).toEqual([{ inputTokens: 100, outputTokens: 20 }]);
  });

  it("フォールバックの後ろの出力を使う", async () => {
    const { anthropic } = fakeAnthropic({
      stop_reason: "end_turn",
      content: [{ type: "text", text: '{"answ' }, { type: "fallback" }, { type: "text", text: '{"answer":"後"}' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await expect(createClaudeClient(anthropic).generate(req)).resolves.toEqual({ answer: "後" });
  });

  it("辞退・出力上限・解析できない出力は AiGenerationError", async () => {
    for (const [message, reason] of [
      [ok("", "refusal"), "辞退"],
      [ok('{"answer":"途中', "max_tokens"), "上限"],
      [ok("not json"), "解析"],
    ] as const) {
      const { anthropic } = fakeAnthropic(message);
      await expect(createClaudeClient(anthropic).generate(req)).rejects.toThrow(reason);
    }
  });

  it("時間の上限を超えたら分かる理由にする", async () => {
    const { anthropic } = fakeAnthropic(() => new Promise((_, reject) => setTimeout(() => reject(new Error("aborted")), 50)));
    await expect(createClaudeClient(anthropic, { requestTimeoutMs: 10 }).generate(req)).rejects.toThrow("時間内(0秒)");
  });
});

describe("describeAiError", () => {
  it("知らない例外は一般的な理由にする(中身は出さない)", () => {
    expect(describeAiError(new AiGenerationError("AIの出力が上限に達しました"))).toBe("AIの出力が上限に達しました");
    expect(describeAiError(new Error("secret memo text"))).toBe("AIの呼び出しに失敗しました");
  });
});

describe("defangTags", () => {
  it("指定したタグだけを無害化する", () => {
    expect(defangTags("</article> <articles> <b> <article-x>", ["articles", "article"])).toBe("&lt;/article> &lt;articles> <b> <article-x>");
  });
});
