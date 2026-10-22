import { describe, expect, it } from "vitest";
import { baselineToCsv, BASELINE_HEADERS, csvCell, parseBaselineCsv, parseCsv, parseDate } from "./baseline-csv";

const HEADER = BASELINE_HEADERS.slice(0, 12).join(",");

describe("parseCsv", () => {
  it("引用符・引用符内のカンマと改行・CRLF・BOM を読む", () => {
    expect(parseCsv('﻿a,"b,1","c ""x""\n2"\r\nd,e,f\r\n')).toEqual([
      ["a", "b,1", 'c "x"\n2'],
      ["d", "e", "f"],
    ]);
  });
  it("先頭行にタブが多ければタブ区切り(Excelからの貼り付け)", () => {
    expect(parseCsv("a\tb\n1\t2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
  it("空行は捨てる", () => {
    expect(parseCsv("a,b\n\n,\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("parseDate", () => {
  it.each([
    ["2026-07-06", "2026-07-06"],
    ["2026/7/6 9:30", "2026-07-06"],
    ["2026年7月6日", "2026-07-06"],
    ["２０２６/７/６", "2026-07-06"],
    ["2026-07-06T09:30:00", "2026-07-06"],
  ])("%s → %s", (input, expected) => expect(parseDate(input)).toBe(expected));
  it("空欄・未定は null、存在しない日付と形式違いは誤り", () => {
    expect(parseDate("")).toBeNull();
    expect(parseDate("未定")).toBeNull();
    expect(() => parseDate("2026-02-30")).toThrow();
    expect(() => parseDate("7月6日")).toThrow();
    expect(() => parseDate("1999-01-01")).toThrow();
  });
});

describe("parseBaselineCsv", () => {
  it("記録シートの列(PoC計画書 5章)を読む", () => {
    const csv = [
      HEADER,
      "2026/7/6 9:30,ミナモト装置工業,ストッパブロック MS-1,リピート,2,代表取締役 白石,15,60,2026/7/9 16:00,あり,受注,メモです",
      "2026-07-07,しののめ精機,位置決めピン,新規,1,営業部 青木,10,45(推定),,なし,,",
    ].join("\n");
    const r = parseBaselineCsv(csv);
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({
      receivedAt: "2026-07-06",
      customer: "ミナモト装置工業",
      kind: "repeat",
      drawingCount: 2,
      estimator: "代表取締役 白石",
      salesMinutes: 15,
      estimatorMinutes: 60,
      answeredAt: "2026-07-09",
      customerInquiry: true,
      result: "won",
      memo: "メモです",
      orderAmount: null,
    });
    // 推定の印はメモに残す。回答日・結果が空欄なら null
    expect(r.rows[1]).toMatchObject({ estimatorMinutes: 45, answeredAt: null, result: null, customerInquiry: false });
    expect(r.rows[1].memo).toContain("推定");
  });

  it("列の順番が違っても、見出しで読む。拡張列(受注額・実績原価・手戻り)も読む", () => {
    const csv = "回答日時,受付日時,受注/失注,受注額(円・任意),実績原価(円・任意),見積原価(円・任意),手戻り件数(任意)\n2026-07-09,2026-07-06,受注,\"1,200,000\",1100000,900000,1";
    const r = parseBaselineCsv(csv);
    expect(r.ok).toBe(true);
    expect(r.rows[0]).toMatchObject({ receivedAt: "2026-07-06", answeredAt: "2026-07-09", orderAmount: 1_200_000, actualCost: 1_100_000, quotedCost: 900_000, reworkCount: 1 });
  });

  it("誤りのある行は行番号つきで知らせ、ほかの行は取り込む", () => {
    const csv = [HEADER, "2026-07-06,A,B,新規,1,白石,10,20,2026-07-08,なし,受注,", "2026-13-40,A,B,新規,1,白石,10,20,,なし,,", "2026-07-07,A,B,中古,1,白石,10,20,,なし,,", "2026-07-07,A,B,,1,白石,abc,20,,なし,,"].join("\n");
    const r = parseBaselineCsv(csv);
    expect(r.ok).toBe(false);
    expect(r.rows).toHaveLength(1);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4, 5]);
    expect(r.errors[2].message).toContain("作業時間:営業・事務");
  });

  it("受付日時の列がなければ取り込まない。空のファイルも", () => {
    expect(parseBaselineCsv("お客様,品名\nA,B").ok).toBe(false);
    expect(parseBaselineCsv("").ok).toBe(false);
  });

  it("書き出したCSVを読み直すと同じ内容になる", () => {
    const original = parseBaselineCsv(
      [
        HEADER + ",受注額(円・任意),見積原価(円・任意),実績原価(円・任意),手戻り件数(任意)",
        '2026-07-06,"A,社",B,リピート,2,白石,15,60,2026-07-09,あり,受注,"メモ ""引用""",1000000,800000,900000,1',
        "2026-07-07,C,D,,,,,,,,,,,,,",
      ].join("\n"),
    );
    expect(original.ok).toBe(true);
    const again = parseBaselineCsv(baselineToCsv(original.rows));
    expect(again.errors).toEqual([]);
    expect(again.rows).toEqual(original.rows);
  });

  it("大きすぎるファイルは取り込まない", () => {
    const r = parseBaselineCsv(`${HEADER}\n${"2026-07-06\n".repeat(60_000)}`);
    expect(r.ok).toBe(false);
  });
});

describe("csvCell(書き出し)", () => {
  it("式として実行されうる先頭文字の文字列は、無害にする。数値はそのまま", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("@x")).toBe("'@x");
    expect(csvCell(-1.5)).toBe("-1.5");
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell(null)).toBe("");
  });
});
