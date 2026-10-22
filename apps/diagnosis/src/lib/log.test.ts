import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorTypeOf, logError } from "./log";

afterEach(() => vi.restoreAllMocks());

describe("logError", () => {
  it("例外の種類とステータスだけを出し、メッセージや原因は出さない", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(new TypeError("株式会社テスト の入力内容", { cause: "秘密の応答" }), { status: 529 });
    logError("失敗しました", error);
    const out = consoleError.mock.calls.flat().join(" ");
    expect(out).toContain("失敗しました");
    expect(out).toContain('"errorType":"TypeError"');
    expect(out).toContain('"status":529');
    expect(out).not.toContain("株式会社テスト");
    expect(out).not.toContain("秘密の応答");
  });
});

describe("errorTypeOf", () => {
  it("Claude SDK の例外はクラスで照合し、決まった名前を返す", () => {
    expect(errorTypeOf(new Anthropic.APIConnectionTimeoutError())).toBe("APIConnectionTimeoutError");
    expect(errorTypeOf(new Anthropic.APIUserAbortError())).toBe("APIUserAbortError");
    expect(errorTypeOf(new Anthropic.APIConnectionError({ message: "x" }))).toBe("APIConnectionError");
  });

  it("本番ビルドで潰れたクラス名(例:s)は使わず Error にする", () => {
    class s extends Error {}
    const minified = new s("入力内容");
    minified.name = s.name;
    expect(errorTypeOf(minified)).toBe("Error");
  });

  it("潰れない組み込みの名前はそのまま使う", () => {
    expect(errorTypeOf(new DOMException("x", "AbortError"))).toBe("AbortError");
    expect(errorTypeOf(new DOMException("x", "TimeoutError"))).toBe("TimeoutError");
    expect(errorTypeOf("文字列")).toBe("string");
  });
});
