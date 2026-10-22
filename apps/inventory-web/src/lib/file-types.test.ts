import { describe, expect, it } from "vitest";
import { MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES } from "./browser-limits";
import { extensionOf, precheckFiles } from "./file-types";

const f = (name: string, size = 100) => ({ name, size });

const oneProblem = (name: string, size = 100) => {
  const r = precheckFiles([f(name, size)]);
  return r && r.ok ? r.entries[0].problem : r?.message;
};

describe("precheckFiles(読み込む前の確認)", () => {
  it("対応している拡張子は大文字小文字を問わない", () => {
    expect(extensionOf("売上.XLSM")).toBe(".xlsm");
    expect(extensionOf("C:\\共有\\台帳.accdb")).toBe(".accdb");
    expect(extensionOf("拡張子なし")).toBe("");
    for (const name of ["a.xlsm", "a.XLSB", "a.xls", "a.xlsx", "a.xlam", "a.xltm", "a.accdb", "a.MDB"]) {
      expect(precheckFiles([f(name)])).toMatchObject({ ok: true });
    }
  });

  it("1ファイルだけのとき、対応していない形式・拡張子なし・0バイト・上限超えは理由を返す", () => {
    expect(oneProblem("議事録.docx")).toContain("この形式(.docx)には対応していません");
    expect(oneProblem("README")).toContain("拡張子なし");
    expect(oneProblem("a.xlsm", 0)).toContain("空");
    expect(precheckFiles([f("a.xlsm", MAX_FILE_BYTES)])).toMatchObject({ ok: true });
    expect(oneProblem("a.xlsm", MAX_FILE_BYTES + 1)).toContain("大きすぎます");
  });

  it("何も選ばれていなければ null", () => {
    expect(precheckFiles([])).toBeNull();
  });

  it("複数のときは、問題のあるファイルだけ除外して他を解析する", () => {
    const r = precheckFiles([f("a.xlsm"), f("b.docx"), f("c.accdb")]);
    expect(r).toMatchObject({ ok: true });
    if (!r?.ok) throw new Error("ok のはず");
    expect(r.entries.map((e) => e.problem === null)).toEqual([true, false, true]);
    expect(r.entries[1].problem).toContain(".docx");
  });

  it("複数で解析できるものが1つも無ければ、全部の理由を返す", () => {
    const r = precheckFiles([f("a.docx"), f("b.txt")]);
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining("解析できるファイルがありませんでした") });
    expect(r && !r.ok && r.message).toContain("a.docx");
    expect(r && !r.ok && r.message).toContain("b.txt");
  });

  it("10ファイルまで。11ファイル、または合計500MB超なら何も始めない", () => {
    const ten = Array.from({ length: MAX_FILES }, (_, i) => f(`a${i}.xlsm`));
    expect(precheckFiles(ten)).toMatchObject({ ok: true });
    expect(precheckFiles([...ten, f("b.xlsm")])).toMatchObject({ ok: false, message: expect.stringContaining("10ファイル") });
    const big = Array.from({ length: 3 }, (_, i) => f(`big${i}.xlsm`, MAX_TOTAL_BYTES / 3 + 1));
    expect(precheckFiles(big)).toMatchObject({ ok: false, message: expect.stringContaining("合計500MB") });
    expect(precheckFiles([f("a.xlsm", MAX_TOTAL_BYTES / 2), f("b.xlsm", MAX_TOTAL_BYTES / 2)])).toMatchObject({ ok: false });
  });
});
