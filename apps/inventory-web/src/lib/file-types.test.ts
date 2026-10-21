import { describe, expect, it } from "vitest";
import { MAX_FILE_BYTES } from "./browser-limits";
import { extensionOf, precheckFiles } from "./file-types";

const f = (name: string, size = 100) => ({ name, size });

describe("precheckFiles(読み込む前の確認)", () => {
  it("対応している拡張子は大文字小文字を問わない", () => {
    expect(extensionOf("売上.XLSM")).toBe(".xlsm");
    expect(extensionOf("C:\\共有\\台帳.accdb")).toBe(".accdb");
    expect(extensionOf("拡張子なし")).toBe("");
    for (const name of ["a.xlsm", "a.XLSB", "a.xls", "a.xlsx", "a.xlam", "a.xltm", "a.accdb", "a.MDB"]) {
      expect(precheckFiles([f(name)])).toMatchObject({ ok: true });
    }
  });

  it("対応していない形式・拡張子なし・0バイト・上限超えは理由を返す", () => {
    expect(precheckFiles([f("議事録.docx")])).toMatchObject({ ok: false, message: expect.stringContaining("この形式(.docx)には対応していません") });
    expect(precheckFiles([f("README")])).toMatchObject({ ok: false, message: expect.stringContaining("拡張子なし") });
    expect(precheckFiles([f("a.xlsm", 0)])).toMatchObject({ ok: false, message: expect.stringContaining("空") });
    expect(precheckFiles([f("a.xlsm", MAX_FILE_BYTES)])).toMatchObject({ ok: true });
    expect(precheckFiles([f("a.xlsm", MAX_FILE_BYTES + 1)])).toMatchObject({ ok: false, message: expect.stringContaining("大きすぎます") });
  });

  it("一度に1ファイルだけ。何も選ばれていなければ null", () => {
    expect(precheckFiles([])).toBeNull();
    expect(precheckFiles([f("a.xlsm"), f("b.xlsm")])).toMatchObject({ ok: false, message: expect.stringContaining("1ファイル") });
  });
});
