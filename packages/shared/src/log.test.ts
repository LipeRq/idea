import { describe, expect, it } from "vitest";
import { errorClassOf, errorStatusOf, errorTypeOf } from "./log";

// Claude SDK の既定のエクスポートの代わり(クラスを静的プロパティに持つ)。実際の SDK での照合は各アプリの log.test.ts で確かめる
class AnthropicError extends Error {}
class APIError extends AnthropicError {}
class APIConnectionError extends APIError {}
class APIConnectionTimeoutError extends APIConnectionError {}
const sdk = { AnthropicError, APIError, APIConnectionError, APIConnectionTimeoutError };

describe("errorTypeOf", () => {
  it("SDK を渡すと、SDK の例外はクラスで照合し、最も近い子クラスの決まった名前を返す", () => {
    expect(errorTypeOf(new APIConnectionTimeoutError("x"), sdk)).toBe("APIConnectionTimeoutError");
    expect(errorTypeOf(new APIConnectionError("x"), sdk)).toBe("APIConnectionError");
    expect(errorTypeOf(new APIError("x"), sdk)).toBe("APIError");
  });

  it("SDK を渡さなければ、潰れない名前だけで判断する", () => {
    expect(errorTypeOf(new APIConnectionTimeoutError("x"))).toBe("Error");
  });

  it("SDK にクラスが無い(テストで差し替えた)ときは照合しない", () => {
    expect(errorTypeOf(new TypeError("x"), { APIError: undefined })).toBe("TypeError");
  });

  it("本番ビルドで潰れたクラス名(例:s)は使わず Error にする", () => {
    class s extends Error {}
    const minified = new s("入力内容");
    minified.name = s.name;
    expect(errorTypeOf(minified, sdk)).toBe("Error");
  });

  it("潰れない組み込みの名前はそのまま使う。Error でなければ typeof", () => {
    expect(errorTypeOf(new DOMException("x", "AbortError"))).toBe("AbortError");
    expect(errorTypeOf(new DOMException("x", "TimeoutError"))).toBe("TimeoutError");
    expect(errorTypeOf("文字列")).toBe("string");
    expect(errorTypeOf(null)).toBe("object");
  });
});

describe("errorClassOf・errorStatusOf", () => {
  it("潰れない名前とステータスだけを返し、メッセージは返さない", () => {
    const error = Object.assign(new TypeError("Module1 の VBA コード"), { status: 529 });
    expect(errorClassOf(error)).toEqual({ errorClass: "TypeError", errorStatus: 529 });
    expect(JSON.stringify(errorClassOf(error))).not.toContain("Module1");
    expect(errorStatusOf(error)).toBe(529);
  });

  it("ステータスが数値でなければ付けない", () => {
    expect(errorClassOf(Object.assign(new Error("x"), { status: "500" }))).toEqual({ errorClass: "Error" });
    expect(errorStatusOf(undefined)).toBeNull();
  });

  it("種類の名前は60文字まで", () => {
    const error = new Error("x");
    error.name = `${"A".repeat(80)}Error`;
    expect(errorClassOf(error).errorClass).toHaveLength(60);
  });
});
