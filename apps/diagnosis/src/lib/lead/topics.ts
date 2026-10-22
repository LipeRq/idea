// 申し込みフォームの「相談したいテーマ」。選ぶと「相談したい内容」の欄の先頭に1行で入り、外すとその行を消す。
// 送るのは「相談したい内容」の文章だけ(テーマを別の項目として送らない)。

function lines(message: string): string[] {
  return message.split(/\r?\n/);
}

/** 「相談したい内容」にテーマの行があるか */
export function hasTopic(message: string, topic: string): boolean {
  return lines(message).some((line) => line.trim() === topic);
}

/** テーマの行を入れる(on)・消す(off)。すでにあれば入れない */
export function toggleTopic(message: string, topic: string, on: boolean): string {
  if (on) {
    if (hasTopic(message, topic)) return message;
    return message.trim() === "" ? topic : `${topic}\n${message}`;
  }
  return lines(message)
    .filter((line) => line.trim() !== topic)
    .join("\n")
    .replace(/^\n+/, "");
}
