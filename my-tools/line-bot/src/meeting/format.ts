// 打ち合わせメモの整理結果を LINE の吹き出しにする(議事録・宿題と確認事項・お礼メール)。
// お礼メールは長押しでそのままコピーできるよう、件名と本文だけの吹き出しにする。
import type { messagingApi } from "@line/bot-sdk";
import { toTextMessages } from "../line/text";
import type { MeetingNotes } from "./notes";

function bullets(items: readonly string[]): string {
  return items.map((i) => `・${i}`).join("\n");
}

export function formatMeetingNotes(notes: MeetingNotes): messagingApi.TextMessage[] {
  const minutes = [`【議事録】${notes.title}`];
  if (notes.summary.length > 0) minutes.push(`要点\n${bullets(notes.summary)}`);
  minutes.push(`決まったこと\n${notes.decisions.length > 0 ? bullets(notes.decisions) : "・なし"}`);

  const tasks = [
    `【宿題】\n${notes.todos.length > 0 ? notes.todos.map((t) => `・${t.owner}:${t.task}(期限 ${t.due})`).join("\n") : "・なし"}`,
  ];
  if (notes.openQuestions.length > 0) tasks.push(`【次回までに確認すること】\n${bullets(notes.openQuestions)}`);
  if (notes.unclear.length > 0) tasks.push(`【読み取れなかったところ】\n${bullets(notes.unclear)}`);

  const blocks = [minutes.join("\n\n"), tasks.join("\n\n")];
  if (notes.email.body.trim()) blocks.push(`件名:${notes.email.subject}\n\n${notes.email.body}`);
  return toTextMessages(blocks);
}
