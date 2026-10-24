import { HTTPFetchError } from "@line/bot-sdk";
import type { z } from "zod";
import type { StructuredClient, StructuredRequest } from "../src/ai";
import type { LineApi, LineMessage, MessageContent } from "../src/line/api";
import type { MeetingNotes } from "../src/meeting/notes";

/** 決まった出力を返す AI の偽物。受け取った依頼は calls に残す */
export function fakeAi(output: unknown | ((req: StructuredRequest<z.ZodType>) => unknown)): StructuredClient & { calls: StructuredRequest<z.ZodType>[] } {
  const calls: StructuredRequest<z.ZodType>[] = [];
  return {
    calls,
    async generate<S extends z.ZodType>(req: StructuredRequest<S>): Promise<z.infer<S>> {
      calls.push(req);
      const value = typeof output === "function" ? (output as (r: StructuredRequest<z.ZodType>) => unknown)(req) : output;
      if (value instanceof Error) throw value;
      return req.schema.parse(value) as z.infer<S>;
    },
  };
}

export function lineError(status: number): HTTPFetchError {
  return new HTTPFetchError(`HTTP ${status}`, { status, statusText: "", headers: new Headers(), body: "{}" });
}

export interface FakeLine extends LineApi {
  pushes: { to: string; messages: LineMessage[]; retryKey: string }[];
  replies: { replyToken: string; messages: LineMessage[] }[];
  loadings: { userId: string; seconds: number }[];
  contents: string[];
}

export function fakeLine(options: { replyError?: Error; pushErrors?: Error[]; content?: MessageContent | Error } = {}): FakeLine {
  const pushErrors = [...(options.pushErrors ?? [])];
  const line: FakeLine = {
    pushes: [],
    replies: [],
    loadings: [],
    contents: [],
    async push(to, messages, retryKey) {
      const e = pushErrors.shift();
      if (e) throw e;
      line.pushes.push({ to, messages, retryKey });
    },
    async reply(replyToken, messages) {
      if (options.replyError) throw options.replyError;
      line.replies.push({ replyToken, messages });
    },
    async showLoading(userId, seconds) {
      line.loadings.push({ userId, seconds });
    },
    async getContent(messageId) {
      line.contents.push(messageId);
      const c = options.content ?? { data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), contentType: "image/jpeg" };
      if (c instanceof Error) throw c;
      return c;
    },
  };
  return line;
}

export function texts(messages: readonly LineMessage[]): string[] {
  return messages.map((m) => (m.type === "text" ? m.text : `[${m.type}]`));
}

/** 打ち合わせメモの整理結果の例 */
export const NOTES: MeetingNotes = {
  title: "〇〇製作所 見積の相談",
  summary: ["見積作成に毎回2時間かかっている", "過去の見積はExcelで管理"],
  decisions: ["11月中に試験導入を始める"],
  todos: [
    { owner: "自分", task: "試験導入の計画書を送る", due: "10/31(金)" },
    { owner: "先方(田中様)", task: "過去の見積を30件集める", due: "未定" },
  ],
  openQuestions: ["図面の保管場所"],
  email: { subject: "本日の打ち合わせのお礼", body: "〇〇製作所\n田中様\n\n本日はありがとうございました。" },
  unclear: ["「みつもりくん」は製品名か不明"],
};
