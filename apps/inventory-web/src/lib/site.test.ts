import { afterEach, describe, expect, it, vi } from "vitest";
import { contactUrl, diagnosisUrl } from "./site";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("結果画面の下の「次の一歩」のリンク先", () => {
  it.each([
    [undefined, null],
    ["", null],
    ["  ", null],
    ["javascript:alert(1)", null],
    ["ftp://example.com/", null],
    ["https://shindan.example.com", "https://shindan.example.com/"],
    [" https://shindan.example.com/?from=x ", "https://shindan.example.com/?from=x"],
  ])("NEXT_PUBLIC_DIAGNOSIS_URL=%j → %j(未設定・http(s) 以外は出さない)", (value, expected) => {
    vi.stubEnv("NEXT_PUBLIC_DIAGNOSIS_URL", value);
    expect(diagnosisUrl()).toBe(expected);
  });

  it("相談ページ(NEXT_PUBLIC_CONTACT_URL)も同じ扱い", () => {
    vi.stubEnv("NEXT_PUBLIC_CONTACT_URL", "javascript:alert(1)");
    expect(contactUrl()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_CONTACT_URL", "https://example.com/contact");
    expect(contactUrl()).toBe("https://example.com/contact");
  });
});
