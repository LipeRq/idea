// ブラウザでも動くように置き換えた部品(コードページのデコード・SHA-256)が、以前の実装(iconv-lite・node:crypto)と同じ結果になること。
import { createHash } from "node:crypto";
import iconv from "iconv-lite";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/sha256";
import { decodeText, decodeUtf16, encodingForCodePage } from "../src/vba/codepage";
import { rng } from "./helpers/fuzz";

describe("コードページのデコード(TextDecoder)", () => {
  it("cp932: iconv-lite と全コードで一致する(Node.js の ICU の制御文字の癖も補正する)", () => {
    const codes: number[][] = [];
    for (let b = 0; b < 0x80; b++) codes.push([b]);
    for (let b = 0xa1; b <= 0xdf; b++) codes.push([b]);
    for (let h = 0x81; h <= 0xfc; h++) {
      if (h >= 0xa0 && h <= 0xdf) continue;
      for (let l = 0x40; l <= 0xfc; l++) if (l !== 0x7f) codes.push([h, l]);
    }
    let compared = 0;
    for (const c of codes) {
      const expected = iconv.decode(Buffer.from(c), "cp932");
      if ([...expected].length !== 1 || expected === "�") continue;
      compared++;
      expect(decodeText(Uint8Array.from(c), 932), c.map((x) => x.toString(16)).join("")).toBe(expected);
    }
    expect(compared).toBeGreaterThan(9000);
    const text = "' 売上データを集計してCSVに出力する ①～② ㈱ 髙 \x1a\x1c\x7f";
    expect(decodeText(iconv.encode(text, "cp932"), 932)).toBe(text);
  });

  it("cp1252: € や “ ” を正しく読む(Node.js の TextDecoder は 0x80〜0x9F を制御文字にしてしまう)", () => {
    for (let b = 0; b < 256; b++) {
      const expected = iconv.decode(Buffer.of(b), "cp1252");
      expect(decodeText(Uint8Array.of(b), 1252)).toBe(expected);
    }
    expect(decodeText(iconv.encode("“Café” €5 – naïve", "cp1252"), 1252)).toBe("“Café” €5 – naïve");
  });

  it("そのほかのコードページ・UTF-16・未対応のコードページ", () => {
    for (const [cp, text] of [
      [936, "销售数据"],
      [950, "銷售資料"],
      [1251, "Продажи"],
      [1250, "Łódź"],
      [65001, "売上 ✓"],
    ] as const) {
      expect(decodeText(iconv.encode(text, cp === 65001 ? "utf8" : `cp${cp}`), cp)).toBe(text);
    }
    expect(decodeUtf16(iconv.encode("売上", "utf16le"))).toBe("売上");
    expect(encodingForCodePage(932)).toBe("cp932");
    expect(encodingForCodePage(65001)).toBe("utf8");
    expect(encodingForCodePage(12345)).toBeNull();
    expect(decodeText(Uint8Array.of(0x41, 0x80), 12345)).toBe("A€");
  });
});

describe("SHA-256", () => {
  it("node:crypto と一致する(ブロック境界の前後と、大きいデータ)", () => {
    const r = rng(42);
    for (const length of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 4096 + 7, 1 << 20]) {
      const data = Uint8Array.from({ length }, () => r.int(256));
      expect(sha256Hex(data), `length=${length}`).toBe(createHash("sha256").update(data).digest("hex"));
    }
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
