import { describe, expect, it } from "vitest";
import { errorClassOf } from "./log";

describe("errorClassOf", () => {
  it("潰れない名前とステータスだけを返し、メッセージは返さない", () => {
    const error = Object.assign(new TypeError("Module1 の VBA コード"), { status: 529 });
    expect(errorClassOf(error)).toEqual({ errorClass: "TypeError", errorStatus: 529 });
  });

  it("本番ビルドで潰れたクラス名(例:s)は使わず Error にする", () => {
    class s extends Error {}
    const minified = new s("x");
    minified.name = s.name;
    expect(errorClassOf(minified)).toEqual({ errorClass: "Error" });
  });

  it("中止・タイムアウトの名前はそのまま使う", () => {
    expect(errorClassOf(new DOMException("x", "AbortError")).errorClass).toBe("AbortError");
    expect(errorClassOf(new DOMException("x", "TimeoutError")).errorClass).toBe("TimeoutError");
    expect(errorClassOf("文字列").errorClass).toBe("string");
  });
});
