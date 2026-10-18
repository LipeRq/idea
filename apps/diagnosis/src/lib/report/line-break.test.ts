import { describe, expect, it } from "vitest";
import { japaneseLineBreak } from "./line-break";

/** 改行できる単位(空文字の区切りを除いたもの) */
const units = (word: string) => japaneseLineBreak(word).filter(Boolean);

describe("japaneseLineBreak", () => {
  it.each([
    "紙や個人PCにある業務データを、共有フォルダに集めましょう。",
    "「問い合わせ・メール対応」で試験導入する",
    "年間約1,406時間(約422万円)",
    "AI-OCRで書類を読み取る\n改行を含む文",
  ])("切り分けた単位をつなげると元の文に戻る: %s", (word) => {
    expect(japaneseLineBreak(word).join("")).toBe(word);
  });

  it("単位の間には空文字(幅0の改行候補)を挟み、末尾にも付ける", () => {
    expect(japaneseLineBreak("業務")).toEqual(["業", "", "務", ""]);
  });

  it("句読点・閉じ括弧・長音・小書きの仮名は行頭に来ないよう前の文字に付ける", () => {
    expect(units("です。")).toEqual(["で", "す。"]);
    expect(units("対応」で")).toEqual(["対", "応」", "で"]);
    expect(units("データ")).toEqual(["デー", "タ"]);
    expect(units("しょう")).toEqual(["しょ", "う"]);
  });

  it("開き括弧は行末に来ないよう次の文字に付ける", () => {
    expect(units("は「問")).toEqual(["は", "「問"]);
    // 開き括弧で終わるときは末尾に改行候補を置かない(次の文字と離さない)
    expect(japaneseLineBreak("は「").at(-1)).toBe("「");
  });

  it("数字と単位、英単語は途中で切らない", () => {
    expect(units("約216万円の削減")).toEqual(["約", "216万円", "の", "削", "減"]);
    expect(units("3,000円")).toEqual(["3,000円"]);
    expect(units("AI-OCRで")).toEqual(["AI-OCR", "で"]);
  });

  it("行幅を超えるほど長い英字の連続は25文字ごとに切る", () => {
    const latin = "A".repeat(60);
    expect(units(`${latin}様`)).toEqual(["A".repeat(25), "A".repeat(25), "A".repeat(10), "様"]);
  });

  it("日本語を含まない語はそのまま(英文の改行は react-pdf に任せる)", () => {
    expect(japaneseLineBreak("Salesforce")).toEqual(["Salesforce", ""]);
  });
});
