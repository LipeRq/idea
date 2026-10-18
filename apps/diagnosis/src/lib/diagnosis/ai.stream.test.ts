import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { generateAiReport } from "./ai";
import { calculateDiagnosis } from "./calculate";
import { buildFallbackReport } from "./fallback";
import type { DiagnosisInput } from "./schema";

// SDKは差し替えず、通信(fetch)だけを偽のSSE応答にして、SDKのストリーム処理を通したときの挙動を確かめる。
// (SDKに構造化出力の解析を任せると、フォールバック前の途中までの文を解析して例外になっていた)

const input: DiagnosisInput = {
  industry: "製造業",
  employees: "31〜100名",
  hourlyCost: 3_000,
  taskHours: { minutes: 100, inquiry: 40, dataEntry: 60 },
  readiness: { dataLocation: 2, manuals: 2, aiUsage: 1, itStaff: 1, rules: 1, leadership: 2 },
  goals: [],
};
const result = calculateDiagnosis(input);
const report = { ...buildFallbackReport(result), summary: "フォールバック先のモデルが書いた総評" };
const json = JSON.stringify(report);

type SseEvent = { type: string } & Record<string, unknown>;

const messageStart: SseEvent = {
  type: "message_start",
  message: {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 0 },
  },
};

function textBlock(index: number, text: string): SseEvent[] {
  return [
    { type: "content_block_start", index, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index },
  ];
}

function fallbackBlock(index: number): SseEvent[] {
  return [
    {
      type: "content_block_start",
      index,
      content_block: {
        type: "fallback",
        from: { model: "claude-opus-5-5" },
        to: { model: "claude-opus-5" },
        trigger: { type: "refusal", category: null },
      },
    },
    { type: "content_block_stop", index },
  ];
}

function end(stopReason: string): SseEvent[] {
  return [
    {
      type: "message_delta",
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: 100 },
    },
    { type: "message_stop" },
  ];
}

function clientStreaming(events: SseEvent[]): Anthropic {
  const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new Anthropic({
    apiKey: "sk-ant-test",
    maxRetries: 0,
    fetch: async () =>
      new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
  });
}

describe("generateAiReport(SDKのストリーム処理を通す)", () => {
  it("途中で辞退→フォールバック先が続きを書いた場合でも、レポートを返す", async () => {
    const cut = 60;
    const client = clientStreaming([
      messageStart,
      ...textBlock(0, json.slice(0, cut)),
      ...fallbackBlock(1),
      ...textBlock(2, json.slice(cut)),
      ...end("end_turn"),
    ]);
    const aiReport = await generateAiReport(input, result, client);
    expect(aiReport.summary).toBe(report.summary);
  });

  it("途中で辞退→フォールバック先が最初から書き直した場合でも、レポートを返す", async () => {
    const client = clientStreaming([
      messageStart,
      ...textBlock(0, '{"summary":"途中まで'),
      ...fallbackBlock(1),
      ...textBlock(2, json),
      ...end("end_turn"),
    ]);
    const aiReport = await generateAiReport(input, result, client);
    expect(aiReport.summary).toBe(report.summary);
  });

  it("出力上限で途中切れなら、解析エラーではなく上限の例外を投げる", async () => {
    const client = clientStreaming([
      messageStart,
      ...textBlock(0, json.slice(0, 80)),
      ...end("max_tokens"),
    ]);
    await expect(generateAiReport(input, result, client)).rejects.toThrow("上限");
  });

  it("フォールバック先も辞退したら、辞退の例外を投げる", async () => {
    const client = clientStreaming([
      messageStart,
      ...textBlock(0, '{"summary":"途中'),
      ...fallbackBlock(1),
      ...end("refusal"),
    ]);
    await expect(generateAiReport(input, result, client)).rejects.toThrow("辞退");
  });
});
