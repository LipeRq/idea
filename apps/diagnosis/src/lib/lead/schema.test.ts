import { describe, expect, it } from "vitest";
import { LeadContactSchema, LeadRequestSchema, leadFieldErrors } from "./schema";

const valid = {
  companyName: "テスト工業",
  name: "山田 太郎",
  email: "taro@example.co.jp",
  phone: "03-1234-5678",
  message: "見積書の作成を効率化したい",
  consent: true,
};

function errorsOf(value: unknown) {
  const result = LeadContactSchema.safeParse(value);
  return result.success ? {} : leadFieldErrors(result.error);
}

describe("LeadContactSchema", () => {
  it("正しい入力は通り、前後の空白を除く", () => {
    const result = LeadContactSchema.parse({
      ...valid,
      companyName: "  テスト工業 ",
      email: " taro@example.co.jp ",
    });
    expect(result.companyName).toBe("テスト工業");
    expect(result.email).toBe("taro@example.co.jp");
  });

  it("電話番号は任意。空欄でも、全角の数字とハイフンでも通る", () => {
    expect(errorsOf({ ...valid, phone: "" })).toEqual({});
    expect(errorsOf({ ...valid, phone: undefined })).toEqual({});
    expect(LeadContactSchema.parse({ ...valid, phone: "０３－１２３４－５６７８" }).phone).toBe(
      "03-1234-5678",
    );
    expect(errorsOf({ ...valid, phone: "+81 3-1234-5678" })).toEqual({});
  });

  it.each(["123", "03-1234-abcd", "0312345678901234", "--0312345678"])(
    "電話番号の形式が正しくなければエラー: %s",
    (phone) => {
      expect(errorsOf({ ...valid, phone }).phone).toMatch(/電話番号/);
    },
  );

  it("必須の欄が空ならそれぞれにエラーを返す", () => {
    expect(
      errorsOf({ companyName: " ", name: "", email: "", phone: "", message: "", consent: false }),
    ).toEqual({
      companyName: "会社名を入力してください",
      name: "氏名を入力してください",
      email: "メールアドレスを入力してください",
      message: "相談したい内容を入力してください",
      consent: "個人情報の取り扱いへの同意が必要です",
    });
  });

  it.each(["taro", "taro@", "@example.com", "taro example@example.com"])(
    "メールアドレスの形式が正しくなければエラー: %s",
    (email) => {
      expect(errorsOf({ ...valid, email }).email).toMatch(/形式/);
    },
  );

  it("文字数の上限を超えるとエラー", () => {
    expect(errorsOf({ ...valid, companyName: "あ".repeat(101) }).companyName).toMatch(/100文字/);
    expect(errorsOf({ ...valid, name: "あ".repeat(51) }).name).toMatch(/50文字/);
    expect(errorsOf({ ...valid, message: "あ".repeat(2_001) }).message).toMatch(/2000文字/);
    expect(errorsOf({ ...valid, message: "あ".repeat(2_000) })).toEqual({});
    // Salesforce のメール項目は80文字まで
    expect(errorsOf({ ...valid, email: `${"a".repeat(68)}@example.com` })).toEqual({});
    expect(errorsOf({ ...valid, email: `${"a".repeat(69)}@example.com` }).email).toMatch(/長すぎ/);
  });

  it("同意は true だけを受け付ける", () => {
    expect(errorsOf({ ...valid, consent: "true" }).consent).toBeDefined();
    expect(errorsOf({ ...valid, consent: undefined }).consent).toBeDefined();
  });
});

describe("leadFieldErrors", () => {
  it("申し込み全体の検証では contact の下のエラーだけを欄に割り当てる", () => {
    const result = LeadRequestSchema.safeParse({
      contact: { ...valid, email: "x" },
      input: { industry: "宇宙業" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(leadFieldErrors(result.error, ["contact"])).toEqual({
        email: "メールアドレスの形式が正しくありません(例:taro@example.co.jp)",
      });
    }
  });
});
