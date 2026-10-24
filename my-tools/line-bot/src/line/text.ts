// LINE のテキストメッセージの組み立て。1回の送信は吹き出し5つまで、1つの吹き出しは5000文字まで。
import type { messagingApi } from "@line/bot-sdk";

export const MAX_TEXT_LENGTH = 5000;
export const MAX_MESSAGES = 5;

const OMITTED = "\n…(長いので省略しました)";

function fit(text: string): string {
  return text.length <= MAX_TEXT_LENGTH ? text : text.slice(0, MAX_TEXT_LENGTH - OMITTED.length) + OMITTED;
}

/**
 * 文章のかたまりを吹き出しにする。5つを超える分は最後の吹き出しにつなげ、長すぎる吹き出しは末尾を省略する。
 * 空のかたまりは使わない。
 */
export function toTextMessages(blocks: readonly string[]): messagingApi.TextMessage[] {
  const texts = blocks.map((b) => b.trim()).filter((b) => b.length > 0);
  if (texts.length > MAX_MESSAGES) {
    const rest = texts.splice(MAX_MESSAGES - 1);
    texts.push(rest.join("\n\n"));
  }
  return texts.map((text) => ({ type: "text", text: fit(text) }));
}
