// PDFの日本語の改行位置。react-pdf は空白でしか改行しないため、日本語の文を
// 改行できる単位に切り分けて返す(react-pdf の hyphenationCallback に渡す)。
// 単位の間に空文字を挟むと、幅0の改行候補になり、改行してもハイフンが入らない。
// react-pdf は文字種(漢字・ひらがな・カタカナ・英字)が変わるところで文を区切ってから
// この関数を呼ぶので、区切りの境目でもハイフンが入らないよう末尾にも空文字を付ける。

// 行頭に来てはいけない文字(句読点・閉じ括弧・小書きの仮名・長音など)
const NO_LINE_START = new Set(
  Array.from("、。,.,.・:;:;!?!?)）」』】〕〉》］｝ー…‥ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ々〜～%％"),
);
// 行末に来てはいけない文字(開き括弧)
const NO_LINE_END = new Set(Array.from("(（「『【〔〈《［｛"));

const JAPANESE = /[\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/u;

// 数字と単位(216万円、3,000円、約3ヶ月)、英単語(AI-OCR、Salesforce)は途中で切らない。
// ただし行幅を超えるほど長い英字の連続は25文字ごとに切る
const UNIT =
  /[0-9０-９][0-9０-９,.]*(?:億|万|千)?(?:円|時間|ヶ月|か月|%|％|点|名|件|倍)?|[A-Za-z][A-Za-z0-9\-_.'’/+&]{0,24}|[\s\S]/gu;

export function japaneseLineBreak(word: string): string[] {
  if (!JAPANESE.test(word)) return [word, ""];

  const chunks: string[] = [];
  let opening = "";
  for (const unit of word.match(UNIT) ?? []) {
    if (!opening && chunks.length > 0 && NO_LINE_START.has(unit)) {
      chunks[chunks.length - 1] += unit;
      continue;
    }
    if (NO_LINE_END.has(unit)) {
      opening += unit;
      continue;
    }
    chunks.push(opening + unit);
    opening = "";
  }
  if (opening) chunks.push(opening);

  const parts = chunks.flatMap((chunk, i) => (i === 0 ? [chunk] : ["", chunk]));
  // 開き括弧で終わるときは、次の文字と離れないよう改行候補を置かない
  return opening ? parts : [...parts, ""];
}
