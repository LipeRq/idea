// LINE Messaging API の呼び出し。公式 SDK を薄く包み、テストでは偽物に差し替える。
import { randomUUID } from "node:crypto";
import { HTTPFetchError, messagingApi } from "@line/bot-sdk";

export type LineMessage = messagingApi.Message;

export interface MessageContent {
  data: Uint8Array;
  contentType: string | null;
}

export interface LineApi {
  /** retryKey は送り直しても二重に届かないようにするための値(同じ送信では同じ値を使う) */
  push(to: string, messages: LineMessage[], retryKey: string): Promise<void>;
  reply(replyToken: string, messages: LineMessage[]): Promise<void>;
  /** 1対1のトークで読み込み中の表示を出す(5〜60秒、5の倍数) */
  showLoading(userId: string, seconds: number): Promise<void>;
  /** 送られてきた写真などの中身。maxBytes を超えたら ContentTooLargeError */
  getContent(messageId: string, maxBytes: number): Promise<MessageContent>;
}

export class ContentTooLargeError extends Error {}

export function createLineApi(channelAccessToken: string): LineApi {
  const client = new messagingApi.MessagingApiClient({ channelAccessToken });
  const blob = new messagingApi.MessagingApiBlobClient({ channelAccessToken });
  return {
    async push(to, messages, retryKey) {
      await client.pushMessage({ to, messages }, retryKey);
    },
    async reply(replyToken, messages) {
      await client.replyMessage({ replyToken, messages });
    },
    async showLoading(userId, seconds) {
      await client.showLoadingAnimation({ chatId: userId, loadingSeconds: seconds });
    },
    async getContent(messageId, maxBytes) {
      const res = await blob.getMessageContentWithHttpInfo(messageId);
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of res.body) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buf.length;
        if (size > maxBytes) {
          res.body.destroy();
          throw new ContentTooLargeError(`${maxBytes} バイトを超えています`);
        }
        chunks.push(buf);
      }
      return { data: new Uint8Array(Buffer.concat(chunks)), contentType: res.httpResponse.headers.get("content-type") };
    },
  };
}

/** LINE の API のエラーから HTTP の状態コードを取り出す(ログ用。取れなければ null) */
export function lineErrorStatus(e: unknown): number | null {
  return e instanceof HTTPFetchError ? e.status : null;
}

function isRetryable(e: unknown): boolean {
  const status = lineErrorStatus(e);
  // 状態コードがない(通信の失敗)・429・5xx は送り直す。400 などは送り直しても同じ
  return status === null || status === 429 || status >= 500;
}

export interface PushOptions {
  attempts?: number;
  waitMs?: (attempt: number) => number;
}

/**
 * プッシュを、同じ再送キーで送り直しつき(既定で3回まで)で送る。
 * 409 は「同じ再送キーの送信がすでに受け付けられた」なので、送れたものとして扱う。
 */
export async function pushWithRetry(line: LineApi, to: string, messages: LineMessage[], options: PushOptions = {}): Promise<void> {
  const attempts = options.attempts ?? 3;
  const waitMs = options.waitMs ?? ((attempt) => 2000 * attempt);
  const retryKey = randomUUID();
  for (let attempt = 1; ; attempt++) {
    try {
      await line.push(to, messages, retryKey);
      return;
    } catch (e) {
      if (lineErrorStatus(e) === 409) return;
      if (attempt >= attempts || !isRetryable(e)) throw e;
      await new Promise((resolve) => setTimeout(resolve, waitMs(attempt)));
    }
  }
}
