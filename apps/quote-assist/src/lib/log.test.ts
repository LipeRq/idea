import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorTypeOf, logError } from "./log";

afterEach(() => vi.restoreAllMocks());

describe("logError", () => {
  it("例外の種類とステータスだけを出し、メッセージや原因は出さない", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(new TypeError("ミナモト装置工業 の図面内容", { cause: "秘密の応答" }), { status: 529 });
    logError("extract_failed", error, { inquiryId: "inq-1" });
    const out = consoleError.mock.calls.flat().join(" ");
    expect(out).toContain('"event":"extract_failed"');
    expect(out).toContain('"errorType":"TypeError"');
    expect(out).toContain('"status":529');
    expect(out).toContain('"inquiryId":"inq-1"');
    expect(out).not.toContain("ミナモト");
    expect(out).not.toContain("秘密の応答");
  });
});

describe("errorTypeOf", () => {
  it("Claude SDK の例外はクラスで照合し、決まった名前を返す", () => {
    expect(errorTypeOf(new Anthropic.APIConnectionTimeoutError())).toBe("APIConnectionTimeoutError");
    expect(errorTypeOf(new Anthropic.APIUserAbortError())).toBe("APIUserAbortError");
  });

  it("本番ビルドで潰れたクラス名(例:s)は使わず Error にする", () => {
    class s extends Error {}
    const minified = new s("x");
    minified.name = s.name;
    expect(errorTypeOf(minified)).toBe("Error");
  });

  it("潰れない組み込みの名前はそのまま使う", () => {
    expect(errorTypeOf(new DOMException("x", "AbortError"))).toBe("AbortError");
    expect(errorTypeOf(null)).toBe("object");
  });
});
