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

// 名前の取り出し方そのものは packages/shared の log.test.ts で確かめる。ここはこのアプリの SDK で照合できることを確かめる
describe("errorTypeOf", () => {
  it("Claude SDK の例外はクラスで照合し、決まった名前を返す", () => {
    expect(errorTypeOf(new Anthropic.APIConnectionTimeoutError())).toBe("APIConnectionTimeoutError");
    expect(errorTypeOf(new Anthropic.APIUserAbortError())).toBe("APIUserAbortError");
    expect(errorTypeOf(new Anthropic.APIConnectionError({ message: "x" }))).toBe("APIConnectionError");
  });
});
