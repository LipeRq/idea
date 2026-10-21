import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_SAMPLE_BYTES, syncSamples, validateManifest } from "./samples-manifest.mjs";

function dirWith(files: Record<string, string | number>) {
  const dir = mkdtempSync(join(tmpdir(), "samples-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof content === "number" ? Buffer.alloc(content) : content);
  }
  return dir;
}

const entry = (file: string, extra = {}) => ({ file, title: "受注管理", description: "説明", highlights: ["見どころ"], ...extra });

describe("サンプルの manifest の契約(docs/design.md §6)", () => {
  it("正しい manifest は通る", () => {
    const dir = dirWith({ "受注管理.xlsm": 10 });
    expect(validateManifest([entry("受注管理.xlsm")], dir)).toMatchObject({ errors: [], samples: [{ file: "受注管理.xlsm" }] });
  });

  it("パス・存在しないファイル・対応外の拡張子・長すぎる題名・重複・大きすぎるファイルは失敗", () => {
    const dir = dirWith({ "a.xlsm": 10, "big.xlsm": MAX_SAMPLE_BYTES + 1 });
    expect(validateManifest([entry("../a.xlsm")], dir).errors.length).toBeGreaterThan(0);
    expect(validateManifest([entry("sub/a.xlsm")], dir).errors.length).toBeGreaterThan(0);
    expect(validateManifest([entry("none.xlsm")], dir).errors).toEqual(["none.xlsm: ファイルがありません"]);
    expect(validateManifest([entry("a.docx")], dir).errors.length).toBeGreaterThan(0);
    expect(validateManifest([entry("a.xlsm", { title: "あ".repeat(41) })], dir).errors.length).toBeGreaterThan(0);
    expect(validateManifest([entry("a.xlsm"), entry("a.xlsm")], dir).errors.length).toBeGreaterThan(0);
    expect(validateManifest([entry("big.xlsm")], dir).errors).toEqual(["big.xlsm: 20MB を超えています"]);
  });

  it("samples が無いときは空の一覧にする(ビルドは止めない)。合格したらコピーして一覧を書く", () => {
    const out = mkdtempSync(join(tmpdir(), "out-"));
    const generatedFile = join(out, "gen/samples.json");
    expect(syncSamples({ sourceDir: join(out, "none"), publicDir: join(out, "public"), generatedFile })).toEqual({ status: "missing", count: 0 });
    expect(readFileSync(generatedFile, "utf8").trim()).toBe("[]");

    const dir = dirWith({ "受注管理.xlsm": 10 });
    writeFileSync(join(dir, "manifest.json"), JSON.stringify([entry("受注管理.xlsm")]));
    mkdirSync(join(out, "public"), { recursive: true });
    expect(syncSamples({ sourceDir: dir, publicDir: join(out, "public"), generatedFile })).toEqual({ status: "ok", count: 1 });
    expect(readFileSync(join(out, "public/受注管理.xlsm")).length).toBe(10);
    expect(JSON.parse(readFileSync(generatedFile, "utf8"))).toHaveLength(1);

    writeFileSync(join(dir, "manifest.json"), JSON.stringify([entry("none.xlsm")]));
    expect(() => syncSamples({ sourceDir: dir, publicDir: join(out, "public"), generatedFile })).toThrow("契約");
  });
});
