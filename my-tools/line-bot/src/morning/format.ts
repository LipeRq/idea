// 毎朝の情報まとめを LINE の吹き出しにする(要点 + 分野ごとに1つ)。
import type { messagingApi } from "@line/bot-sdk";
import { toTextMessages } from "../line/text";
import { formatJstDate } from "../time";
import type { FailedSource } from "./collect";
import type { Digest } from "./digest";

export function formatDigest(digest: Digest, date: Date, failed: readonly FailedSource[]): messagingApi.TextMessage[] {
  const header = [`おはようございます。${formatJstDate(date)}の情報まとめです。`];
  if (digest.highlights.length > 0) header.push(["今日の要点", ...digest.highlights.map((h) => `・${h}`)].join("\n"));
  const failedNote = failed.length > 0 ? `(取得できなかった情報源:${failed.map((f) => f.name).join("、")})` : null;
  // 記事が1件もなければ(情報源がすべて取得できなかったときなど)、吹き出し1つで知らせる
  if (digest.sections.every((s) => s.items.length === 0)) {
    return toTextMessages([[...header, "新しい記事はありませんでした。", ...(failedNote ? [failedNote] : [])].join("\n\n")]);
  }
  if (digest.note) header.push(`(AIの要約なし:${digest.note}。新しい記事の見出しだけを送ります)`);

  const sections = digest.sections.map((section) => {
    const lines = [`【${section.category.label}】`];
    if (section.items.length === 0) {
      lines.push("新しい記事はありませんでした。");
    } else {
      lines.push(
        section.items
          .map((item, i) => [`${i + 1}. ${item.headline}(${item.source})`, item.summary, item.link].filter((l) => l.length > 0).join("\n"))
          .join("\n\n"),
      );
    }
    return lines.join("\n");
  });

  if (failedNote) sections[sections.length - 1] += `\n\n${failedNote}`;
  return toTextMessages([header.join("\n\n"), ...sections]);
}
