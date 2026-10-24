import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AiGenerationError } from "../src/claude";
import { ContentTooLargeError } from "../src/line/api";
import type { MeetingInput } from "../src/meeting/notes";
import { detectImageType, handleWebhook, HELP_TEXT, readWebhookConfig, type WebhookDeps } from "../src/webhook/handler";
import { fakeLine, lineError, NOTES, texts, type FakeLine } from "./helpers";

const SECRET = "test-channel-secret";
const OWNER = "U0123456789abcdef0123456789abcdef";

function sign(body: string, secret = SECRET): string {
  return createHmac("SHA256", secret).update(body).digest("base64");
}

function request(body: unknown, signature?: string, method = "POST"): Request {
  const text = JSON.stringify(body);
  return new Request("https://bot.example/api/webhook", {
    method,
    headers: { "content-type": "application/json", "x-line-signature": signature ?? sign(text) },
    body: method === "POST" ? text : undefined,
  });
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    type: "message",
    mode: "active",
    timestamp: 0,
    webhookEventId: "01ABC",
    deliveryContext: { isRedelivery: false },
    source: { type: "user", userId: OWNER },
    replyToken: "reply-token-1",
    message: { id: "m1", type: "text", text: "〇〇製作所の田中様と見積の打ち合わせ。毎回2時間かかっている。", quoteToken: "q" },
    ...overrides,
  };
}

interface Setup {
  line: FakeLine;
  deps: WebhookDeps;
  inputs: MeetingInput[];
  logs: { event: string; fields?: Record<string, unknown> }[];
  /** defer に渡された処理がすべて終わるまで待つ */
  settle: () => Promise<unknown>;
}

function setup(options: { line?: FakeLine; organize?: WebhookDeps["organize"] | "error" } = {}): Setup {
  const line = options.line ?? fakeLine();
  const inputs: MeetingInput[] = [];
  const tasks: Promise<unknown>[] = [];
  const logs: Setup["logs"] = [];
  const organize: WebhookDeps["organize"] =
    options.organize === "error"
      ? async () => {
          throw new AiGenerationError("AIの出力を解析できませんでした");
        }
      : options.organize === undefined
        ? async (input) => {
            inputs.push(input);
            return NOTES;
          }
        : options.organize;
  return {
    line,
    inputs,
    logs,
    settle: () => Promise.all(tasks),
    deps: {
      config: { channelSecret: SECRET, ownerUserId: OWNER },
      line,
      organize,
      defer: (t) => tasks.push(t),
      log: (e, fields) => logs.push({ event: e, fields }),
    },
  };
}

async function send(s: Setup, ...events: unknown[]): Promise<Response> {
  const res = await handleWebhook(request({ destination: "Ubot", events }), s.deps);
  await s.settle();
  return res;
}

describe("handleWebhook:受け付け", () => {
  it("署名が合わなければ 401 で、何もしない", async () => {
    const s = setup();
    const res = await handleWebhook(request({ destination: "Ubot", events: [event()] }, sign("other body")), s.deps);
    await s.settle();
    expect(res.status).toBe(401);
    expect(s.line.replies).toHaveLength(0);
  });

  it("別のチャネルシークレットの署名も 401", async () => {
    const s = setup();
    const body = { destination: "Ubot", events: [event()] };
    const res = await handleWebhook(request(body, sign(JSON.stringify(body), "other-secret")), s.deps);
    expect(res.status).toBe(401);
  });

  it("POST 以外は 405", async () => {
    const s = setup();
    const res = await handleWebhook(new Request("https://bot.example/api/webhook"), s.deps);
    expect(res.status).toBe(405);
  });

  it("LINE Developers の「検証」(events が空)には 200", async () => {
    const s = setup();
    expect((await send(s)).status).toBe(200);
  });

  it("自分以外・グループ・再送・待機中のイベントには何も返さない", async () => {
    const s = setup();
    await send(
      s,
      event({ source: { type: "user", userId: "Uother" } }),
      event({ source: { type: "group", groupId: "G1", userId: OWNER } }),
      event({ deliveryContext: { isRedelivery: true } }),
      event({ mode: "standby" }),
    );
    expect(s.line.replies).toHaveLength(0);
    expect(s.line.pushes).toHaveLength(0);
    expect(s.inputs).toHaveLength(0);
    expect(s.logs.filter((l) => l.event === "event_ignored").map((l) => l.fields?.reason)).toEqual(["not_owner", "not_owner", "redelivery", "standby"]);
  });
});

describe("handleWebhook:打ち合わせメモ", () => {
  it("テキストのメモを整理し、読み込み中の表示を出してから3つの吹き出しで返信する", async () => {
    const s = setup();
    expect((await send(s, event())).status).toBe(200);
    expect(s.inputs).toEqual([{ kind: "text", text: "〇〇製作所の田中様と見積の打ち合わせ。毎回2時間かかっている。" }]);
    expect(s.line.loadings).toEqual([{ userId: OWNER, seconds: 60 }]);
    expect(s.line.replies).toHaveLength(1);
    expect(s.line.replies[0].replyToken).toBe("reply-token-1");
    expect(texts(s.line.replies[0].messages)[0]).toContain("【議事録】〇〇製作所 見積の相談");
    expect(s.line.replies[0].messages).toHaveLength(3);
    // ログにメモの中身は書かない
    expect(JSON.stringify(s.logs)).not.toContain("田中");
  });

  it("返信できなければ(時間切れなど)プッシュで送る", async () => {
    const s = setup({ line: fakeLine({ replyError: lineError(400) }) });
    await send(s, event());
    expect(s.line.pushes).toHaveLength(1);
    expect(s.line.pushes[0].to).toBe(OWNER);
    expect(s.line.pushes[0].messages).toHaveLength(3);
  });

  it("整理に失敗したら理由を返す", async () => {
    const s = setup({ organize: "error" });
    await send(s, event());
    expect(texts(s.line.replies[0].messages)).toEqual(["メモを整理できませんでした(AIの出力を解析できませんでした)。少し待ってから、もう一度送ってください。"]);
  });

  it("API キーがなければ、その旨を返す", async () => {
    const s = setup({ organize: null });
    await send(s, event());
    expect(texts(s.line.replies[0].messages)[0]).toContain("Claude API のキーが設定されていません");
  });

  it("短いテキスト・「使い方」・友だち追加には使い方を返す", async () => {
    const s = setup();
    await send(
      s,
      event({ message: { id: "m2", type: "text", text: "こんにちは", quoteToken: "q" } }),
      event({ message: { id: "m3", type: "text", text: "使い方", quoteToken: "q" } }),
      event({ type: "follow", message: undefined, follow: { isUnblocked: false } }),
    );
    expect(s.inputs).toHaveLength(0);
    expect(s.line.replies.map((r) => texts(r.messages)[0])).toEqual([HELP_TEXT, HELP_TEXT, HELP_TEXT]);
  });

  it("写真1枚は中身を取得して、画像として整理する", async () => {
    const s = setup();
    await send(s, event({ message: { id: "img1", type: "image", contentProvider: { type: "line" }, quoteToken: "q" } }));
    expect(s.line.contents).toEqual(["img1"]);
    expect(s.inputs[0]).toMatchObject({ kind: "image", mediaType: "image/jpeg" });
    expect(s.line.replies[0].messages).toHaveLength(3);
  });

  it("同時に送られた複数枚の写真には、1枚目にだけ案内を返す", async () => {
    const s = setup();
    const image = (index: number) => event({ replyToken: `r${index}`, message: { id: `img${index}`, type: "image", contentProvider: { type: "line" }, quoteToken: "q", imageSet: { id: "set1", index, total: 2 } } });
    await send(s, image(1), image(2));
    expect(s.inputs).toHaveLength(0);
    expect(s.line.replies).toHaveLength(1);
    expect(texts(s.line.replies[0].messages)[0]).toContain("写真は1枚ずつ");
  });

  it("大きすぎる写真・読めない形式は、その旨を返す", async () => {
    const big = setup({ line: fakeLine({ content: new ContentTooLargeError("too large") }) });
    await send(big, event({ message: { id: "img1", type: "image", contentProvider: { type: "line" }, quoteToken: "q" } }));
    expect(texts(big.line.replies[0].messages)[0]).toContain("写真が大きすぎて読めません");

    const odd = setup({ line: fakeLine({ content: { data: new Uint8Array([1, 2, 3, 4]), contentType: null } }) });
    await send(odd, event({ message: { id: "img1", type: "image", contentProvider: { type: "line" }, quoteToken: "q" } }));
    expect(texts(odd.line.replies[0].messages)[0]).toContain("この形式の写真は読めません");
    expect(odd.inputs).toHaveLength(0);
  });

  it("音声・スタンプには案内を返す", async () => {
    const s = setup();
    await send(
      s,
      event({ message: { id: "a1", type: "audio", duration: 1000, contentProvider: { type: "line" } } }),
      event({ message: { id: "s1", type: "sticker", packageId: "1", stickerId: "1", stickerResourceType: "STATIC", quoteToken: "q" } }),
    );
    expect(s.line.replies.map((r) => texts(r.messages)[0])).toEqual([
      "音声メッセージはまだ読めません。スマホの音声入力で文字にして送ってください。",
      "打ち合わせのメモを、テキストか写真1枚で送ってください。",
    ]);
  });
});

describe("detectImageType", () => {
  it("JPEG・PNG・GIF・WebP を見分ける", () => {
    expect(detectImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe1]))).toBe("image/jpeg");
    expect(detectImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(detectImageType(new TextEncoder().encode("GIF89a"))).toBe("image/gif");
    expect(detectImageType(new TextEncoder().encode("RIFF1234WEBPVP8 "))).toBe("image/webp");
    expect(detectImageType(new Uint8Array([0, 1, 2]))).toBeNull();
  });
});

describe("readWebhookConfig", () => {
  it("足りない環境変数の名前を返す", () => {
    expect(readWebhookConfig({ LINE_USER_ID: OWNER })).toEqual({ ok: false, missing: ["LINE_CHANNEL_SECRET", "LINE_CHANNEL_ACCESS_TOKEN"] });
    expect(readWebhookConfig({ LINE_USER_ID: OWNER, LINE_CHANNEL_SECRET: "s", LINE_CHANNEL_ACCESS_TOKEN: "t" })).toMatchObject({ ok: true });
  });
});
