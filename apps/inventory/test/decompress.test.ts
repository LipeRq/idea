import { describe, expect, it } from "vitest";
import { decompressContainer, VbaFormatError } from "../src/vba/decompress";
import { compress } from "./helpers/ovba";

const hex = (s: string) => Uint8Array.from(s.trim().split(/\s+/).map((x) => parseInt(x, 16)));
const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe("decompressContainer([MS-OVBA] 3.2 の例)", () => {
  it("3.2.1 圧縮なしの例", () => {
    const out = decompressContainer(hex("01 19 B0 00 61 62 63 64 65 66 67 68 00 69 6A 6B 6C 6D 6E 6F 70 00 71 72 73 74 75 76 2E"));
    expect(text(out)).toBe("abcdefghijklmnopqrstuv.");
  });

  it("3.2.2 通常の圧縮の例", () => {
    const out = decompressContainer(
      hex(
        "01 2F B0 00 23 61 61 61 62 63 64 65 82 66 00 70 61 67 68 69 6A 01 38 08 61 6B 6C 00 30 6D 6E 6F 70 06 71 02 70 04 10 72 73 74 75 76 10 77 78 79 7A 00 3C",
      ),
    );
    expect(text(out)).toBe("#aaabcdefaaaaghijaaaaaklaaamnopqaaaaaaaaaaaarstuvwxyzaaa");
  });

  it("3.2.3 最大圧縮の例(重なりのあるコピー)", () => {
    expect(text(decompressContainer(hex("01 03 B0 02 61 45 00")))).toBe("a".repeat(73));
  });

  it("offset の位置から解凍する", () => {
    const data = hex("FF FF FF 01 03 B0 02 61 45 00");
    expect(decompressContainer(data, 3).length).toBe(73);
  });

  it("署名が不正なら VbaFormatError", () => {
    expect(() => decompressContainer(hex("00 03 B0"))).toThrow(VbaFormatError);
  });
});

describe("compress → decompressContainer の往復", () => {
  it("4096 バイトを超える(複数チャンクの)テキスト", () => {
    const src = new TextEncoder().encode(
      Array.from({ length: 400 }, (_, i) => `Sub Proc${i}()\r\n    MsgBox "${i}"\r\nEnd Sub\r\n`).join(""),
    );
    expect(src.length).toBeGreaterThan(4096 * 3);
    const packed = compress(src);
    expect(packed.length).toBeLessThan(src.length);
    expect(decompressContainer(packed)).toEqual(src);
  });

  it("圧縮できないデータは非圧縮チャンクになる", () => {
    let x = 12345;
    const random = Uint8Array.from({ length: 4096 * 2 }, () => {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      return x >> 16;
    });
    const packed = compress(random);
    expect(packed[2] & 0x80).toBe(0); // 先頭チャンクの CompressedFlag が 0
    expect(decompressContainer(packed)).toEqual(random);
  });

  it("空のデータ", () => {
    expect(decompressContainer(compress(new Uint8Array()))).toEqual(new Uint8Array());
  });
});
