import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import worker, { type Env } from "../src/worker";

const SECRET = "s3cret";
const OWNER = "Uowner";

function env(overrides: Partial<Env> = {}): Env & { sent: unknown[] } {
  const sent: unknown[] = [];
  return {
    LINE_CHANNEL_SECRET: SECRET,
    LINE_CHANNEL_ACCESS_TOKEN: "dummy",
    LINE_USER_ID: OWNER,
    MEMO_QUEUE: {
      async send(body) {
        sent.push(body);
      },
    },
    sent,
    ...overrides,
  };
}

function post(body: unknown, path = "/webhook"): Request {
  const text = JSON.stringify(body);
  return new Request(`https://line-bot.example.workers.dev${path}`, {
    method: "POST",
    headers: { "x-line-signature": createHmac("SHA256", SECRET).update(text).digest("base64") },
    body: text,
  });
}

const memo = (userId: string) => ({
  type: "message",
  mode: "active",
  timestamp: 0,
  webhookEventId: "x",
  deliveryContext: { isRedelivery: false },
  source: { type: "user", userId },
  replyToken: "r",
  message: { id: "1", type: "text", text: "打ち合わせのメモです。二十文字を超える長さにしています。", quoteToken: "q" },
});

describe("worker.fetch", () => {
  it("自分のイベントだけをキューに入れて 200 を返す", async () => {
    const e = env();
    const res = await worker.fetch(post({ destination: "U", events: [memo(OWNER), memo("Uother")] }), e);
    expect(res.status).toBe(200);
    expect(e.sent).toHaveLength(1);
  });

  it("/webhook 以外は 404、設定が足りなければ 500", async () => {
    expect((await worker.fetch(post({ events: [] }, "/"), env())).status).toBe(404);
    expect((await worker.fetch(post({ events: [] }), env({ LINE_CHANNEL_SECRET: undefined }))).status).toBe(500);
  });

  it("キューに入れられなくても 200 を返す(LINE に送り直させない)", async () => {
    const e = env({
      MEMO_QUEUE: {
        async send() {
          throw new Error("queue down");
        },
      },
    });
    expect((await worker.fetch(post({ destination: "U", events: [memo(OWNER)] }), e)).status).toBe(200);
  });
});

describe("worker.queue", () => {
  it("処理できなくても、取り出したメッセージは送り直さない(ack する)", async () => {
    const acks: number[] = [];
    const message = (i: number, body: unknown) => ({ body: body as never, ack: () => acks.push(i) });
    // 1件目:設定が足りない / 2件目:自分以外(何もしない)
    await worker.queue({ messages: [message(1, memo(OWNER))] }, env({ LINE_USER_ID: undefined }));
    await worker.queue({ messages: [message(2, memo("Uother"))] }, env());
    expect(acks).toEqual([1, 2]);
  });
});
