import Anthropic from "@anthropic-ai/sdk";
import { beforeAll, describe, expect, it } from "vitest";
import { DEMO_SCENARIOS } from "../demo/scenarios";
import { extractWithClaude } from "../extraction/claude";
import type { ExtractionOutput } from "../extraction/schema";
import { loadReferenceData, type ReferenceData } from "../reference/load";
import { DATA_DIR, TEST_TODAY } from "../test-helpers";

// SDKは差し替えず、通信(fetch)だけを偽のSSE応答にして、SDKのストリーム処理を通したときの挙動を確かめる。
// 以前は構造化出力の解析をSDKに任せていたため、生成の途中でフォールバックが起きると、
// 途中までの文の解析でSDKが例外を投げ、切り替え後のモデルが書いた正しい読み取り結果まで捨てていた。

let ref: ReferenceData;
beforeAll(async () => {
  ref = await loadReferenceData(DATA_DIR);
});

const scenario = DEMO_SCENARIOS[0];
const email = scenario.buildEmail(TEST_TODAY);
const output: ExtractionOutput = scenario.buildExtraction({ emailBody: email.body, today: TEST_TODAY });
const json = JSON.stringify(output);
const pdf = new TextEncoder().encode("%PDF-1.7 test");

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
    { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 100 } },
    { type: "message_stop" },
  ];
}

function clientStreaming(events: SseEvent[]): Anthropic {
  const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new Anthropic({
    apiKey: "sk-ant-test",
    maxRetries: 0,
    fetch: async () => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
  });
}

const call = (client: Anthropic) =>
  extractWithClaude({
    drawings: [{ fileName: "MS-24017_C_1.pdf", data: pdf }],
    email,
    receivedAt: TEST_TODAY,
    rates: ref.rates,
    client,
  });

describe("extractWithClaude(SDKのストリーム処理を通す)", () => {
  it("フォールバックがなければ、そのまま読み取り結果を返す", async () => {
    const r = await call(clientStreaming([messageStart, ...textBlock(0, json), ...end("end_turn")]));
    expect(r.output).toEqual(output);
    expect(r.usage.outputTokens).toBe(100);
  });

  it("途中で辞退→フォールバック先が続きを書いた場合でも、読み取り結果を返す", async () => {
    const cut = 150;
    const r = await call(
      clientStreaming([
        messageStart,
        ...textBlock(0, json.slice(0, cut)),
        ...fallbackBlock(1),
        ...textBlock(2, json.slice(cut)),
        ...end("end_turn"),
      ]),
    );
    expect(r.output).toEqual(output);
    // 応答したモデル(フォールバック先)を記録する
    expect(r.model).toBe("claude-opus-5");
  });

  it("途中で辞退→フォールバック先が最初から書き直した場合でも、読み取り結果を返す", async () => {
    const r = await call(
      clientStreaming([
        messageStart,
        ...textBlock(0, '{"summary":"途中まで'),
        ...fallbackBlock(1),
        ...textBlock(2, json),
        ...end("end_turn"),
      ]),
    );
    expect(r.output).toEqual(output);
  });

  it("出力上限で途中切れなら、解析エラーではなく上限の例外を投げる", async () => {
    await expect(call(clientStreaming([messageStart, ...textBlock(0, json.slice(0, 300)), ...end("max_tokens")]))).rejects.toThrow(
      "上限",
    );
  });

  it("フォールバック先も辞退したら、辞退の例外を投げる(途中までの文は使わない)", async () => {
    await expect(
      call(clientStreaming([messageStart, ...textBlock(0, json.slice(0, 80)), ...fallbackBlock(1), ...end("refusal")])),
    ).rejects.toThrow("辞退");
  });
});
