import { describe, expect, it } from "vitest";
import { decodeCsvBytes, parseCsv, parseCsvRecords, toCsv } from "./lib/csv";

describe("CSV", () => {
  it("引用符・カンマ・改行・空行・BOM・CRLF を読み、書き出して読み直すと元に戻る", () => {
    const text = '﻿id,note,body\r\na1,"カンマ,入り","1行目\n2行目 ""引用"""\r\n\r\na2,,\r\n';
    const rows = parseCsv(text);
    expect(rows).toEqual([
      ["id", "note", "body"],
      ["a1", "カンマ,入り", '1行目\n2行目 "引用"'],
      ["a2", "", ""],
    ]);
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it("ヘッダーつきの行にする(列名・値の前後の空白は除く。足りない列は空)", () => {
    const { headers, records } = parseCsvRecords(" id , 品名 \nx, ねじ \ny\n");
    expect(headers).toEqual(["id", "品名"]);
    expect(records).toEqual([{ id: "x", 品名: "ねじ" }, { id: "y", 品名: "" }]);
  });

  it("引用符が閉じていなければ失敗する", () => {
    expect(() => parseCsv('a,"b')).toThrow("引用符");
  });

  it("文字コードは UTF-8 を試し、読めなければ Shift_JIS(Excel の既定)として読む", () => {
    expect(decodeCsvBytes(new TextEncoder().encode("﻿品名"))).toBe("品名");
    expect(decodeCsvBytes(new Uint8Array([0x95, 0x69, 0x96, 0xbc]))).toBe("品名");
  });
});
