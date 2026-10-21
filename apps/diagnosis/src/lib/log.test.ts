import { afterEach, describe, expect, it, vi } from "vitest";
import { logError } from "./log";

afterEach(() => vi.restoreAllMocks());

describe("logError", () => {
  it("例外の種類とステータスだけを出し、メッセージや原因は出さない", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    class ApiError extends Error {
      status = 529;
    }
    logError("失敗しました", new ApiError("株式会社テスト の入力内容", { cause: "秘密の応答" }));
    const out = consoleError.mock.calls.flat().join(" ");
    expect(out).toContain("失敗しました");
    expect(out).toContain('"errorType":"ApiError"');
    expect(out).toContain('"status":529');
    expect(out).not.toContain("株式会社テスト");
    expect(out).not.toContain("秘密の応答");
  });
});
