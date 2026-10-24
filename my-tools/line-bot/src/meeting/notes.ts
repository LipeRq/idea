// 打ち合わせのメモ(テキスト・手書きメモの写真)から、議事録・宿題・お礼メールの下書きを作る。
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import type { StructuredClient } from "../claude";
import { formatJstFullDate } from "../time";

export const MeetingNotesSchema = z.object({
  title: z.string().describe("打ち合わせの名前。相手の会社名や議題から20文字程度。分からなければ「打ち合わせ」。"),
  summary: z.array(z.string()).describe("要点。3件まで。各30文字以内の1文。"),
  decisions: z.array(z.string()).describe("決まったこと。なければ空配列。"),
  todos: z
    .array(
      z.object({
        owner: z.string().describe("担当。「自分」「先方(〇〇様)」のように書く。分からなければ「未定」。"),
        task: z.string().describe("やること。25文字以内。"),
        due: z.string().describe("期限。メモに書かれた期限を「10/31(金)」のような日付にする。期限がなければ「未定」。"),
      }),
    )
    .describe("宿題。誰が・何を・いつまでに。なければ空配列。"),
  openQuestions: z.array(z.string()).describe("次回までに確認すること・まだ決まっていないこと。なければ空配列。"),
  email: z.object({
    subject: z.string().describe("お礼メールの件名。"),
    body: z.string().describe("お礼メールの本文。宛名から結びの挨拶まで。署名は書かない。"),
  }),
  unclear: z.array(z.string()).describe("メモから読み取れなかった・判断できなかった点(写真の読めない文字、誤変換と思われる語の元の形など)。なければ空配列。"),
});
export type MeetingNotes = z.infer<typeof MeetingNotesSchema>;

export type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export type MeetingInput = { kind: "text"; text: string } | { kind: "image"; data: Uint8Array; mediaType: ImageMediaType };

const SYSTEM = `あなたは、中小企業のAI導入を支援するITコンサルタントの秘書です。
コンサルタント本人(以下「自分」)が打ち合わせのあとに送ってきたメモから、議事録・宿題・お礼メールの下書きを作ります。
メモは、箇条書き、スマホの音声入力で話した文、手書きのメモやホワイトボードの写真のいずれかです。

守ること:
- メモに書かれていないことを足さないでください。推測が必要なところは「〜と思われる」と書くか、unclear に書いてください。
- 音声入力の誤変換と思われる語は、文脈から正しい語に直してください。直した語が社名・人名・製品名などの固有名詞なら、元の形を unclear に書いてください。
- 金額・日付・数量・固有名詞は、メモのとおりに書いてください。
- 期限の「来週金曜」「月末」などは、ユーザーメッセージにある今日の日付をもとに「10/31(金)」のような日付にしてください。
- お礼メールは、打ち合わせの相手に自分から送るものです。丁寧すぎない自然なビジネスメールにし、決まったことと宿題(とくに自分の宿題)を簡潔に入れてください。
  宛名は「〇〇株式会社 〇〇様」の形にし、分からない部分は〇〇のままにしてください。署名は書かないでください(メールソフトが付けます)。
- 写真に打ち合わせのメモが写っていない場合は、title を「メモが見つかりません」とし、unclear にその旨を書いて、ほかは空にしてください。
- 議事録・宿題は短く書いてください(1項目1文、体言止めでよい)。お礼メールは5〜10行にしてください。
- 出力はすべて日本語にしてください。`;

function buildUser(input: MeetingInput, today: Date): string | BetaContentBlockParam[] {
  const head = `今日の日付:${formatJstFullDate(today)}`;
  if (input.kind === "text") {
    return `${head}\n\n<memo>\n${input.text}\n</memo>`;
  }
  return [
    { type: "image", source: { type: "base64", media_type: input.mediaType, data: Buffer.from(input.data).toString("base64") } },
    { type: "text", text: `${head}\n\n写真は打ち合わせのメモです。読み取って整理してください。` },
  ];
}

export async function organizeMeetingNotes(input: MeetingInput, client: StructuredClient, today: Date): Promise<MeetingNotes> {
  return client.generate({
    system: SYSTEM,
    user: buildUser(input, today),
    schema: MeetingNotesSchema,
    maxTokens: 16_000,
    effort: "medium",
  });
}
