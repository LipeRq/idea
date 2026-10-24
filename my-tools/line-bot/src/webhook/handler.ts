// LINE からの受信(Webhook)の処理。受け口(src/app/api/webhook/route.ts)から呼ぶ。Next.js には依存しない(テストしやすいように)。
//
// LINE には受け取ったらすぐ 200 を返し、整理は応答のあとに行う(defer。受け口では Next.js の after)。
// 自分(LINE_USER_ID)以外からのメッセージには何も返さない。ログには種類と件数だけを書き、メモの中身は書かない。
import { validateSignature, type webhook } from "@line/bot-sdk";
import { describeAiError } from "../claude";
import { ContentTooLargeError, lineErrorStatus, pushWithRetry, type LineApi, type LineMessage } from "../line/api";
import { toTextMessages } from "../line/text";
import { formatMeetingNotes } from "../meeting/format";
import type { ImageMediaType, MeetingInput, MeetingNotes } from "../meeting/notes";

export interface WebhookConfig {
  channelSecret: string;
  ownerUserId: string;
}

export type Logger = (event: string, fields?: Record<string, string | number | boolean | null>) => void;

export interface WebhookDeps {
  config: WebhookConfig;
  line: LineApi;
  /** メモを整理する(Claude)。API キーがなければ null */
  organize: ((input: MeetingInput) => Promise<MeetingNotes>) | null;
  /** 応答のあとも処理を続けさせる(Next.js の after) */
  defer: (task: Promise<unknown>) => void;
  log: Logger;
}

/** これより短いテキストはメモとして扱わず、使い方を返す */
export const MIN_MEMO_LENGTH = 20;
/** Claude API に送れる写真の大きさの上限 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const LOADING_SECONDS = 60;

export const HELP_TEXT = `このボットでできること

・打ち合わせのメモを送る
  → 議事録・宿題・お礼メールの下書きを返します。テキスト(20文字以上)か、手書きメモの写真1枚を送ってください。スマホの音声入力で話すと早く送れます。

・毎朝の情報まとめ
  → 毎朝7時ごろ、テクノロジー・株式投資・大きいニュース・ヘルスケアの新着をまとめて届けます。`;

const HELP_WORDS = /^(使い方|つかいかた|ヘルプ|help|\?|\uFF1F)$/iu;

export async function handleWebhook(request: Request, deps: WebhookDeps): Promise<Response> {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });
  const body = await request.text();
  const signature = request.headers.get("x-line-signature");
  if (!signature || !validateSignature(body, deps.config.channelSecret, signature)) {
    deps.log("signature_invalid");
    return new Response("Unauthorized", { status: 401 });
  }
  let payload: webhook.CallbackRequest;
  try {
    payload = JSON.parse(body) as webhook.CallbackRequest;
  } catch {
    deps.log("body_invalid");
    return new Response("Bad Request", { status: 400 });
  }
  const events = Array.isArray(payload.events) ? payload.events : [];
  // LINE Developers の「検証」ボタンは、events が空の Webhook を送ってくる
  deps.log("webhook_received", { events: events.length });
  for (const event of events) {
    deps.defer(
      processEvent(event, deps).catch((e) => {
        deps.log("event_failed", { type: event.type, error: e instanceof Error ? e.name : "unknown", status: lineErrorStatus(e) });
      }),
    );
  }
  return new Response("OK", { status: 200 });
}

function isFromOwner(event: webhook.Event, ownerUserId: string): boolean {
  return event.source?.type === "user" && (event.source as webhook.UserSource).userId === ownerUserId;
}

export async function processEvent(event: webhook.Event, deps: WebhookDeps): Promise<void> {
  if (!isFromOwner(event, deps.config.ownerUserId)) {
    deps.log("event_ignored", { reason: "not_owner", type: event.type });
    return;
  }
  // LINE の再送は、すでに処理を始めたものなので二重に処理しない
  if (event.deliveryContext?.isRedelivery) {
    deps.log("event_ignored", { reason: "redelivery", type: event.type });
    return;
  }
  if (event.mode === "standby") {
    deps.log("event_ignored", { reason: "standby", type: event.type });
    return;
  }

  if (event.type === "follow") {
    await deliver(event.replyToken, toTextMessages([HELP_TEXT]), deps, "help");
    return;
  }
  if (event.type !== "message") {
    deps.log("event_ignored", { reason: "unsupported_event", type: event.type });
    return;
  }

  const message = event.message;
  switch (message.type) {
    case "text": {
      const text = message.text.trim();
      if (HELP_WORDS.test(text) || text.length < MIN_MEMO_LENGTH) {
        await deliver(event.replyToken, toTextMessages([HELP_TEXT]), deps, "help");
        return;
      }
      await organizeAndDeliver(event.replyToken, { kind: "text", text }, deps);
      return;
    }
    case "image": {
      const set = (message as webhook.ImageMessageContent).imageSet;
      if (set?.total !== undefined && set.total > 1) {
        // 同時に送られた写真は1枚ずつ別のイベントで届く。案内は1枚目に対してだけ返す
        if (set.index === undefined || set.index === 1) {
          await deliver(event.replyToken, toTextMessages(["写真は1枚ずつ送ってください(複数枚をまとめて読む機能はまだありません)。"]), deps, "notice");
        }
        return;
      }
      await organizeImage(event.replyToken, message.id, deps);
      return;
    }
    case "audio":
      await deliver(event.replyToken, toTextMessages(["音声メッセージはまだ読めません。スマホの音声入力で文字にして送ってください。"]), deps, "notice");
      return;
    default:
      await deliver(event.replyToken, toTextMessages(["打ち合わせのメモを、テキストか写真1枚で送ってください。"]), deps, "notice");
  }
}

/** 写真の中身から形式を判定する(LINE の写真はふつう JPEG) */
export function detectImageType(data: Uint8Array): ImageMediaType | null {
  const b = data;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

async function organizeImage(replyToken: string | undefined, messageId: string, deps: WebhookDeps): Promise<void> {
  let data: Uint8Array;
  try {
    ({ data } = await deps.line.getContent(messageId, MAX_IMAGE_BYTES));
  } catch (e) {
    const tooLarge = e instanceof ContentTooLargeError;
    deps.log("image_fetch_failed", { tooLarge, status: lineErrorStatus(e) });
    const text = tooLarge ? "写真が大きすぎて読めません(5MBまで)。画質を下げて送ってください。" : "写真を受け取れませんでした。もう一度送ってください。";
    await deliver(replyToken, toTextMessages([text]), deps, "error");
    return;
  }
  const mediaType = detectImageType(data);
  if (!mediaType) {
    deps.log("image_type_unknown", { bytes: data.length });
    await deliver(replyToken, toTextMessages(["この形式の写真は読めません。JPEG か PNG で送ってください。"]), deps, "error");
    return;
  }
  await organizeAndDeliver(replyToken, { kind: "image", data, mediaType }, deps);
}

async function organizeAndDeliver(replyToken: string | undefined, input: MeetingInput, deps: WebhookDeps): Promise<void> {
  if (!deps.organize) {
    await deliver(replyToken, toTextMessages(["メモの整理に必要な Claude API のキーが設定されていません。"]), deps, "error");
    return;
  }
  // 読み込み中の表示は出せなくても整理は続ける
  await deps.line.showLoading(deps.config.ownerUserId, LOADING_SECONDS).catch((e) => deps.log("loading_failed", { status: lineErrorStatus(e) }));

  const started = Date.now();
  let messages: LineMessage[];
  try {
    const notes = await deps.organize(input);
    messages = formatMeetingNotes(notes);
    deps.log("meeting_organized", { input: input.kind, ms: Date.now() - started, todos: notes.todos.length });
  } catch (e) {
    const reason = describeAiError(e);
    deps.log("meeting_failed", { input: input.kind, ms: Date.now() - started, reason });
    messages = toTextMessages([`メモを整理できませんでした(${reason})。少し待ってから、もう一度送ってください。`]);
  }
  await deliver(replyToken, messages, deps, "meeting");
}

/**
 * 返信(無料)で送り、返信できなければプッシュ(月200通の無料枠を使う)で送る。
 * 返信は受け取ってから一定の時間内しか使えないので、整理に時間がかかったときはプッシュになる。
 */
async function deliver(replyToken: string | undefined, messages: LineMessage[], deps: WebhookDeps, kind: string): Promise<void> {
  if (replyToken) {
    try {
      await deps.line.reply(replyToken, messages);
      deps.log("delivered", { kind, via: "reply", bubbles: messages.length });
      return;
    } catch (e) {
      deps.log("reply_failed", { kind, status: lineErrorStatus(e) });
    }
  }
  await pushWithRetry(deps.line, deps.config.ownerUserId, messages);
  deps.log("delivered", { kind, via: "push", bubbles: messages.length });
}

export type ConfigResult = { ok: true; config: WebhookConfig & { channelAccessToken: string } } | { ok: false; missing: string[] };

/** 受信用のサーバーに必要な環境変数を読む(API キーは任意。なければ整理できない旨を返す) */
export function readWebhookConfig(env: Readonly<Record<string, string | undefined>>): ConfigResult {
  const names = ["LINE_CHANNEL_SECRET", "LINE_CHANNEL_ACCESS_TOKEN", "LINE_USER_ID"] as const;
  const missing = names.filter((n) => !env[n]);
  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    config: { channelSecret: env.LINE_CHANNEL_SECRET!, channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN!, ownerUserId: env.LINE_USER_ID! },
  };
}
