import { describe, expect, it } from "vitest";
import { formatMeetingNotes } from "../src/meeting/format";
import { organizeMeetingNotes } from "../src/meeting/notes";
import { fakeClaude, NOTES, texts } from "./helpers";


describe("formatMeetingNotes", () => {
  it("議事録・宿題と確認事項・お礼メールの3つの吹き出しにする", () => {
    expect(texts(formatMeetingNotes(NOTES))).toEqual([
      "【議事録】〇〇製作所 見積の相談\n\n要点\n・見積作成に毎回2時間かかっている\n・過去の見積はExcelで管理\n\n決まったこと\n・11月中に試験導入を始める",
      "【宿題】\n・自分:試験導入の計画書を送る(期限 10/31(金))\n・先方(田中様):過去の見積を30件集める(期限 未定)\n\n【次回までに確認すること】\n・図面の保管場所\n\n【読み取れなかったところ】\n・「みつもりくん」は製品名か不明",
      "件名:本日の打ち合わせのお礼\n\n〇〇製作所\n田中様\n\n本日はありがとうございました。",
    ]);
  });

  it("空の項目は「なし」にし、メール本文がなければメールの吹き出しを出さない", () => {
    const t = texts(formatMeetingNotes({ ...NOTES, summary: [], decisions: [], todos: [], openQuestions: [], unclear: [], email: { subject: "", body: " " } }));
    expect(t).toEqual(["【議事録】〇〇製作所 見積の相談\n\n決まったこと\n・なし", "【宿題】\n・なし"]);
  });
});

describe("organizeMeetingNotes", () => {
  const TODAY = new Date("2026-10-24T06:00:00Z");

  it("テキストのメモは今日の日付と一緒に渡す", async () => {
    const claude = fakeClaude(NOTES);
    await organizeMeetingNotes({ kind: "text", text: "田中様と見積の件" }, claude, TODAY);
    expect(claude.calls[0].user).toBe("今日の日付:2026年10月24日(土)\n\n<memo>\n田中様と見積の件\n</memo>");
    expect(claude.calls[0].effort).toBe("medium");
  });

  it("写真は base64 の画像ブロックにして、説明の前に置く", async () => {
    const claude = fakeClaude(NOTES);
    await organizeMeetingNotes({ kind: "image", data: new Uint8Array([1, 2, 3]), mediaType: "image/jpeg" }, claude, TODAY);
    const user = claude.calls[0].user;
    expect(Array.isArray(user)).toBe(true);
    expect((user as unknown[])[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AQID" } });
  });
});
