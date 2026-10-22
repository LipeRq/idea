import { describe, expect, it } from "vitest";
import { parseStructuredOutput, type SafeParser } from "./structured-output";

type Report = { summary: string; items: string[] };

// zod のスキーマの代わり(safeParse だけを使う)
const schema: SafeParser<Report> = {
  safeParse(value) {
    const v = value as Partial<Report> | null;
    return v && typeof v.summary === "string" && Array.isArray(v.items)
      ? { success: true, data: { summary: v.summary, items: v.items } }
      : { success: false };
  },
};

const text = (t: string) => ({ type: "text", text: t });
const fallback = { type: "fallback" };
const report: Report = { summary: "受注の流れの要約", items: ["見積", "受注", "請求"] };
const json = JSON.stringify(report);

describe("parseStructuredOutput", () => {
  it("テキストが1つなら、それを検証して返す", () => {
    expect(parseStructuredOutput([text(json)], schema)).toEqual(report);
  });

  it("思考ブロックなどテキスト以外は無視する", () => {
    const thinking = { type: "thinking", thinking: "...", signature: "s" };
    expect(parseStructuredOutput([thinking, text(json)], schema)).toEqual(report);
  });

  it("出力前のフォールバック:fallback の後のテキストを使う", () => {
    expect(parseStructuredOutput([fallback, text(json)], schema)).toEqual(report);
  });

  it("途中でのフォールバック:切り替え後に最初から書き直した場合", () => {
    expect(parseStructuredOutput([text(json.slice(0, 20)), fallback, text(json)], schema)).toEqual(report);
  });

  it("途中でのフォールバック:切り替え後のモデルが続きを書いた場合", () => {
    expect(parseStructuredOutput([text(json.slice(0, 25)), fallback, text(json.slice(25))], schema)).toEqual(report);
  });

  it("フォールバックが2回あっても、最後の切り替え後のテキストを優先する", () => {
    expect(parseStructuredOutput([text("{"), fallback, text('{"summ'), fallback, text(json)], schema)).toEqual(report);
  });

  it("フォールバックが2回あり、2回目の後が1回目の後の続きなら、1回目の後からつなげる", () => {
    const content = [text('{"x'), fallback, text(json.slice(0, 25)), fallback, text(json.slice(25))];
    expect(parseStructuredOutput(content, schema)).toEqual(report);
  });

  it("途中までの文しかない・JSON でない・スキーマに合わなければ null", () => {
    expect(parseStructuredOutput([text(json.slice(0, 30))], schema)).toBeNull();
    expect(parseStructuredOutput([text(json.slice(0, 30)), fallback], schema)).toBeNull();
    expect(parseStructuredOutput([text("not json")], schema)).toBeNull();
    expect(parseStructuredOutput([text('{"a":1}')], schema)).toBeNull();
    expect(parseStructuredOutput([], schema)).toBeNull();
  });
});
