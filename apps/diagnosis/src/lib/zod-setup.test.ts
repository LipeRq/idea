import { describe, expect, it } from "vitest";
import { z } from "zod";
import "./lead/schema";

describe("zod の設定", () => {
  it("画面で使うスキーマを読み込むと、eval を使わない設定になる(CSPの違反を出さない)", () => {
    expect(z.config().jitless).toBe(true);
  });
});
