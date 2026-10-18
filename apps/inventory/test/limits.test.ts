// 悪意のある・極端なファイル(zip 爆弾、OLE のセクタチェーンの循環、MS-OVBA の不正なデータ、
// 正規表現が2乗の時間になる入力など)で、上限に達したら日本語のエラーで止まり、ハングしないことを確かめる。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import CFB from "cfb";
import { strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { analyzeBuffer, CorruptFileError, InventoryError, LimitExceededError, renderMarkdown } from "../src";
import { Budget } from "../src/limits";
import { readCompoundFile } from "../src/ole/compoundFile";
import { analyzeVbaProject } from "../src/vba/analyze";
import { decompressContainer, VbaFormatError } from "../src/vba/decompress";
import { parseDirStream } from "../src/vba/dir";
import { parseModuleSource } from "../src/vba/parse";
import type { RawVbaProject } from "../src/vba/project";
import { compress } from "./helpers/ovba";
import { restoreZip } from "./helpers/fuzz";
import { SAMPLE_PROJECT } from "./helpers/sampleVba";
import { buildXls, buildXlsm } from "./helpers/workbooks";

const xlsm = buildXlsm(SAMPLE_PROJECT);

/** 処理時間を測る(2乗の時間になる入力でも、ここで決めた時間内に終わること) */
function timed<T>(f: () => T): { value: T; ms: number } {
  const start = performance.now();
  const value = f();
  return { value, ms: performance.now() - start };
}

function catchError(f: () => unknown): unknown {
  try {
    f();
  } catch (e) {
    return e;
  }
  throw new Error("例外が発生しませんでした");
}

/** xlsm の一部のファイルを差し替える */
function withParts(parts: Record<string, Uint8Array | string>, base = xlsm, level: 0 | 6 = 6): Uint8Array {
  const files: Record<string, Uint8Array> = unzipSync(base);
  for (const [k, v] of Object.entries(parts)) files[k] = typeof v === "string" ? strToU8(v) : v;
  return zipSync(files, { level });
}

/** zip の中央ディレクトリで、指定したファイルの「展開後のサイズ」欄を書き換える */
function patchDeclaredSize(zip: Uint8Array, name: string, size: number): Uint8Array {
  const out = Uint8Array.from(zip);
  const view = new DataView(out.buffer);
  const target = new TextEncoder().encode(name);
  for (let p = 0; p + 46 < out.length; p++) {
    if (view.getUint32(p, true) !== 0x02014b50) continue;
    const n = out.subarray(p + 46, p + 46 + view.getUint16(p + 28, true));
    if (n.length === target.length && n.every((b, i) => b === target[i])) {
      view.setUint32(p + 24, size, true);
      return out;
    }
  }
  throw new Error(`${name} が見つかりません`);
}

const sheet = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr codeName="Sheet1"/><dimension ref="A1"/><sheetData>${body}</sheetData></worksheet>`;

describe("zip(.xlsm 等)の上限", () => {
  it("展開後のサイズの宣言が上限を超える部品は、展開する前に止める", () => {
    const e = catchError(() => analyzeBuffer(xlsm, "a.xlsm", { limits: { maxPartBytes: 1024 } }));
    expect(e).toBeInstanceOf(LimitExceededError);
    expect((e as LimitExceededError).kind).toBe("partSize");
    expect((e as Error).message).toMatch(/展開後のサイズ.*上限.*zip 爆弾/);
  });

  it("宣言より大きく展開される部品(zip 爆弾)は、展開の途中で止める", () => {
    const bomb = withParts({ "xl/worksheets/sheet2.xml": sheet(`<row r="1">${" ".repeat(20 * 1024 * 1024)}</row>`) });
    const lied = patchDeclaredSize(bomb, "xl/worksheets/sheet2.xml", 4096);
    expect(lied.length).toBeLessThan(200 * 1024);
    const { value: e, ms } = timed(() => catchError(() => analyzeBuffer(lied, "bomb.xlsm")));
    expect(e).toBeInstanceOf(LimitExceededError);
    expect((e as Error).message).toContain("宣言されたサイズ(4096バイト)を超えて展開される");
    expect(ms).toBeLessThan(2000);
  });

  it("取り出したデータの合計が上限を超えたら止める", () => {
    const big = sheet(`<row r="1"><c r="A1"><v>${"1".repeat(400_000)}</v></c></row>`);
    const files: Record<string, string> = {};
    for (let i = 1; i <= 2; i++) files[`xl/worksheets/sheet${i}.xml`] = big;
    const e = catchError(() => analyzeBuffer(withParts(files), "a.xlsm", { limits: { maxTotalBytes: 700_000 } }));
    expect(e).toBeInstanceOf(LimitExceededError);
    expect((e as LimitExceededError).kind).toBe("totalSize");
  });

  it("zip 内のファイル数が上限を超えたら止める(エントリ数の欄が嘘でも)", () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 60; i++) many[`xl/media/image${i}.png`] = "x";
    const e = catchError(() => analyzeBuffer(withParts(many), "a.xlsm", { limits: { maxZipEntries: 50 } }));
    expect((e as LimitExceededError).kind).toBe("entryCount");

    // 終端レコードのエントリ数だけを 65535 に書き換えたもの(実際の中央ディレクトリは短い)
    const patched = Uint8Array.from(xlsm);
    const view = new DataView(patched.buffer);
    let eocd = patched.length - 22;
    while (view.getUint32(eocd, true) !== 0x06054b50) eocd--;
    view.setUint16(eocd + 8, 0xffff, true);
    view.setUint16(eocd + 10, 0xffff, true);
    const e2 = catchError(() => analyzeBuffer(patched, "a.xlsm", { limits: { maxZipEntries: 1000 } }));
    expect(e2).toBeInstanceOf(LimitExceededError);
    // 上限以内なら、壊れた中央ディレクトリとして止まる
    expect(catchError(() => analyzeBuffer(patched, "a.xlsm", { limits: { maxZipEntries: 100_000 } }))).toBeInstanceOf(CorruptFileError);
  });

  it("DTD(DOCTYPE・エンティティ)を含む XML は解析しない(エンティティ展開の爆弾対策)", () => {
    const lol = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">]><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="&lol2;" sheetId="1" r:id="rId1"/></sheets></workbook>`;
    const e = catchError(() => analyzeBuffer(withParts({ "xl/workbook.xml": lol }), "a.xlsm"));
    expect(e).toBeInstanceOf(CorruptFileError);
    expect((e as Error).message).toContain("DTD");
  });

  it("入れ子が極端に深い XML でもスタックがあふれてクラッシュしない", () => {
    const deep = `<workbook>${"<a>".repeat(200_000)}${"</a>".repeat(200_000)}</workbook>`;
    const e = catchError(() => analyzeBuffer(withParts({ "xl/workbook.xml": deep }), "a.xlsm"));
    expect(e).toBeInstanceOf(InventoryError);
  });

  it("入力ファイルのサイズ・制限時間の上限", () => {
    expect((catchError(() => analyzeBuffer(xlsm, "a.xlsm", { limits: { maxInputBytes: 100 } })) as LimitExceededError).kind).toBe("inputSize");
    const e = catchError(() => analyzeBuffer(xlsm, "a.xlsm", { limits: { timeLimitMs: -1 } }));
    expect((e as LimitExceededError).kind).toBe("time");
    expect((e as Error).message).toMatch(/制限時間.*中止しました/);
  });
});

describe("OLE 複合ファイル(.xls・vbaProject.bin)の循環・範囲外参照", () => {
  const xls = buildXls(SAMPLE_PROJECT);
  const u32 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset).getUint32(at, true);
  const setFat = (b: Uint8Array, sector: number, value: number) => {
    const fatSector = u32(b, 0x4c);
    new DataView(b.buffer, b.byteOffset).setUint32((fatSector + 1) * 512 + sector * 4, value, true);
  };

  it("ディレクトリのセクタチェーンが循環していたら CorruptFileError", () => {
    const bad = Uint8Array.from(xls);
    const dirStart = u32(bad, 0x30);
    setFat(bad, dirStart, dirStart);
    const { value: e, ms } = timed(() => catchError(() => analyzeBuffer(bad, "a.xls")));
    expect(e).toBeInstanceOf(CorruptFileError);
    expect((e as Error).message).toContain("循環");
    expect(ms).toBeLessThan(1000);
  });

  it("Workbook ストリームのチェーン(FAT)が循環・範囲外を指していたら CorruptFileError", () => {
    // 4096 バイト以上のストリームは FAT のチェーンで読まれる
    const c = CFB.utils.cfb_new();
    const workbook = [0x09, 0x08, 0x10, 0x00, 0x00, 0x06, 0x05, 0x00, ...new Array(12).fill(0), ...new Array(9000).fill(0)];
    CFB.utils.cfb_add(c, "/Workbook", Buffer.from(workbook));
    const bin = new Uint8Array(CFB.write(c, { type: "buffer", fileType: "cfb" }) as Buffer);
    const entry = readCompoundFile(bin).find("Workbook")!;
    expect(entry.size).toBeGreaterThanOrEqual(4096);
    expect(analyzeBuffer(bin, "a.xls").file.format).toBe("xls");
    for (const next of [entry.start, 0x00ffffff]) {
      const bad = Uint8Array.from(bin);
      setFat(bad, entry.start + 1, next);
      const e = catchError(() => analyzeBuffer(bad, "a.xls"));
      expect(e).toBeInstanceOf(CorruptFileError);
      expect((e as Error).message).toMatch(/循環|ファイルの外/);
    }
  });

  it("開始セクタが範囲外で、その先の FAT が循環している(cfb ライブラリはメモリ不足でプロセスごと落ちた)", () => {
    const c = CFB.utils.cfb_new();
    CFB.utils.cfb_add(c, "/Workbook", Buffer.alloc(9000));
    const bin = new Uint8Array(CFB.write(c, { type: "buffer", fileType: "cfb" }) as Buffer);
    const view = new DataView(bin.buffer);
    const sectors = Math.ceil((bin.length - 512) / 512);
    const dir = (u32(bin, 0x30) + 1) * 512;
    for (let i = 0; i < 4; i++) {
      if (new TextDecoder("utf-16le").decode(bin.subarray(dir + i * 128, dir + i * 128 + 16)).startsWith("Workbook")) {
        view.setUint32(dir + i * 128 + 116, sectors + 3, true);
      }
    }
    setFat(bin, sectors + 3, 5);
    setFat(bin, 5, 6);
    setFat(bin, 6, 5);
    const { value: e, ms } = timed(() => catchError(() => analyzeBuffer(bin, "a.xls")));
    expect(e).toBeInstanceOf(CorruptFileError);
    expect(ms).toBeLessThan(1000);
  });

  it("ミニストリームのチェーン(ミニ FAT)が循環していたら CorruptFileError", () => {
    const entry = readCompoundFile(xls).find("Workbook")!;
    expect(entry.size).toBeLessThan(4096);
    const bad = Uint8Array.from(xls);
    const miniFat = (u32(bad, 0x3c) + 1) * 512;
    new DataView(bad.buffer).setUint32(miniFat + (entry.start + 1) * 4, entry.start, true);
    const e = catchError(() => analyzeBuffer(bad, "a.xls"));
    expect(e).toBeInstanceOf(CorruptFileError);
    expect((e as Error).message).toContain("循環");
  });

  it("DIFAT のチェーンが自分自身を指していても止まる", () => {
    const bad = Uint8Array.from(xls);
    const view = new DataView(bad.buffer);
    view.setUint32(0x44, 0, true); // 最初の DIFAT セクタ = 0
    view.setUint32(0x48, 0x7fffffff, true); // DIFAT セクタ数 = 巨大
    // セクタ 0 の最後の4バイト(次の DIFAT セクタ)を 0 にして自分自身を指させる
    view.setUint32(512 + 508, 0, true);
    const { value: e, ms } = timed(() => catchError(() => analyzeBuffer(bad, "a.xls")));
    expect(e).toBeInstanceOf(InventoryError);
    expect(ms).toBeLessThan(1000);
  });

  it("ディレクトリの兄弟・子のリンクが循環していてもハングしない", () => {
    const bad = Uint8Array.from(xls);
    const dirStart = u32(bad, 0x30);
    const dir = (dirStart + 1) * 512;
    const view = new DataView(bad.buffer);
    // ルートの子 → エントリ1、エントリ1 の左右 → ルートと自分、子 → 自分
    view.setUint32(dir + 76, 1, true);
    view.setUint32(dir + 128 + 68, 0, true);
    view.setUint32(dir + 128 + 72, 1, true);
    view.setUint32(dir + 128 + 76, 1, true);
    const { ms } = timed(() => {
      try {
        analyzeBuffer(bad, "a.xls");
      } catch (e) {
        expect(e).toBeInstanceOf(InventoryError);
      }
    });
    expect(ms).toBeLessThan(1000);
  });

  it("cfb が書いたファイル(ミニストリーム・入れ子のストレージ・4096 バイト以上のストリーム)を正しく読む", () => {
    const container = CFB.utils.cfb_new();
    const big = Uint8Array.from({ length: 10_000 }, (_, i) => (i * 31) & 0xff);
    CFB.utils.cfb_add(container, "/small", Buffer.from("小さいストリーム"));
    CFB.utils.cfb_add(container, "/dir1/dir2/big", Buffer.from(big));
    CFB.utils.cfb_add(container, "/dir1/日本語", Buffer.from([1, 2, 3]));
    const bin = new Uint8Array(CFB.write(container, { type: "buffer", fileType: "cfb" }) as Buffer);
    const ours = readCompoundFile(bin);
    expect(new TextDecoder().decode(ours.read("small")!)).toBe("小さいストリーム");
    expect(ours.read("/DIR1/dir2/BIG")).toEqual(big);
    expect([...ours.read("dir1/日本語")!]).toEqual([1, 2, 3]);
    expect(ours.read("dir1")).toBeNull(); // ストレージは読めない
    expect(ours.read("nothing")).toBeNull();
  });
});

describe("MS-OVBA(VBA の圧縮データ・dir ストリーム)", () => {
  it("解凍後のサイズが上限を超えたら LimitExceededError", () => {
    const packed = compress(new Uint8Array(2 * 1024 * 1024).fill(0x61));
    expect(packed.length).toBeLessThan(80_000);
    const e = catchError(() => decompressContainer(packed, 0, 1024 * 1024));
    expect(e).toBeInstanceOf(LimitExceededError);
    expect(decompressContainer(packed, 0, 4 * 1024 * 1024).length).toBe(2 * 1024 * 1024);
  });

  it("チャンクの先頭より前を指す CopyToken は VbaFormatError", () => {
    // 01 / ヘッダ(圧縮・サイズ 4) / フラグ 0x01(最初がトークン) / トークン 0x0000
    expect(() => decompressContainer(Uint8Array.of(0x01, 0x02, 0xb0, 0x01, 0x00, 0x00))).toThrow(VbaFormatError);
  });

  it("モジュールのソースが上限を超えるブックは、日本語のエラーで止める", () => {
    const code = `Sub A()\n${"    x = 1 ' 長いモジュール\n".repeat(60_000)}End Sub`;
    const big = buildXlsm({ modules: [{ name: "Module1", type: "standard", code }] });
    const e = catchError(() => analyzeBuffer(big, "a.xlsm", { limits: { maxModuleSourceBytes: 512 * 1024 } }));
    expect(e).toBeInstanceOf(LimitExceededError);
    expect((e as Error).message).toContain("VBA のソースの解凍後のサイズが上限");
  });

  it("dir ストリームのレコード長が不正なら VbaFormatError(解析は警告付きで続く)", () => {
    const rec = Uint8Array.of(0x03, 0x00, 0xff, 0xff, 0xff, 0x7f, 0xe4, 0x04);
    expect(() => parseDirStream(rec)).toThrow(VbaFormatError);
    const files = unzipSync(xlsm);
    const bin = CFB.read(files["xl/vbaProject.bin"], { type: "buffer" });
    CFB.utils.cfb_add(bin, "/VBA/dir", Buffer.from(compress(rec)));
    const broken = withParts({ "xl/vbaProject.bin": new Uint8Array(CFB.write(bin, { type: "buffer", fileType: "cfb" }) as Buffer) });
    const r = analyzeBuffer(broken, "a.xlsm");
    expect(r.vba).toBeNull();
    expect(r.warnings.join("\n")).toContain("VBAプロジェクトを読めませんでした");
  });
});

describe("BIFF8(.xls)のレコード", () => {
  /** Workbook ストリームだけの .xls を作る */
  const xlsWith = (workbook: number[]) => {
    const c = CFB.utils.cfb_new();
    CFB.utils.cfb_add(c, "/Workbook", Buffer.from(workbook));
    return new Uint8Array(CFB.write(c, { type: "buffer", fileType: "cfb" }) as Buffer);
  };
  const rec = (type: number, data: number[] = []) => [type & 0xff, type >> 8, data.length & 0xff, data.length >> 8, ...data];
  const bof = (dt: number) => rec(0x0809, [0x00, 0x06, dt, 0x00, 0xbb, 0x0d, 0xcc, 0x07, 0, 0, 0, 0, 6, 0, 0, 0]);
  const boundsheet = (offset: number, name: string) => rec(0x0085, [offset & 0xff, (offset >> 8) & 0xff, offset >> 16, 0, 0, 0, name.length, 0, ...[...name].map((c) => c.charCodeAt(0))]);

  it("シートの位置が全部同じ・重なり合っていても、2乗の時間をかけずに読む", () => {
    const sheets = 20_000;
    const globals = [...bof(5), ...Array.from({ length: sheets }, (_, i) => boundsheet(i % 2 === 0 ? 0 : i * 3, `S${i}`)).flat(), ...rec(0x000a)];
    const body = Array.from({ length: 20_000 }, () => rec(0x0006, new Array(20).fill(0))).flat();
    const { value: r, ms } = timed(() => analyzeBuffer(xlsWith([...globals, ...body]), "a.xls", { limits: { maxSheets: 5_000 } }));
    expect(r.excel!.sheets).toHaveLength(5_000);
    expect(r.warnings.join("\n")).toContain("シートが 20000 件あり上限(5000 件)を超える");
    expect(ms).toBeLessThan(3000);
  });

  it("レコード長がストリームの外を指していても止まる", () => {
    const r = analyzeBuffer(xlsWith([...bof(5), 0x85, 0x00, 0xff, 0xff, 1, 2, 3]), "a.xls");
    expect(r.excel!.sheets).toEqual([]);
  });
});

describe("2乗の時間になりうる入力(正規表現の後戻り・繰り返しの探索)", () => {
  const LIMIT_MS = 2000;
  it("閉じタグの無い <f> が大量にあるシート", () => {
    const bad = withParts({ "xl/worksheets/sheet2.xml": sheet("<c><f>".repeat(200_000)) }, xlsm, 0);
    const { value: r, ms } = timed(() => analyzeBuffer(bad, "a.xlsm"));
    expect(r.excel!.sheets[1].formulaCount).toBe(200_000);
    expect(ms).toBeLessThan(LIMIT_MS);
  });

  it("> の無い開始タグ・閉じタグの無い図形・VML・外部リンク", () => {
    const files = unzipSync(xlsm);
    const bad = withParts({
      "xl/worksheets/sheet1.xml": strToU8(new TextDecoder().decode(files["xl/worksheets/sheet1.xml"]) + "<control name=".repeat(100_000)),
      "xl/drawings/drawing1.xml": `<xdr:wsDr>${'<xdr:sp macro="x"><a:t>'.repeat(100_000)}`,
      "xl/drawings/vmlDrawing1.vml": `<xml>${"<v:shape><x:FmlaMacro>".repeat(100_000)}</xml>`,
      "xl/externalLinks/externalLink1.xml": `<externalLink><externalBook r:id="rId1">${"<sheetName ".repeat(200_000)}>`,
    });
    const { value: r, ms } = timed(() => analyzeBuffer(bad, "a.xlsm"));
    expect(r.excel!.externalLinks).toHaveLength(1);
    expect(ms).toBeLessThan(LIMIT_MS);
  });

  const project = (source: string): RawVbaProject => ({
    name: "P",
    codePage: 932,
    encoding: "cp932",
    lockedForViewing: false,
    hasPassword: false,
    references: [],
    modules: [{ name: "Module1", streamName: "Module1", type: "standard", source, attributes: {} }],
  });

  it("Open が大量にある行・行継続が延々と続くソース・巨大な1行", () => {
    for (const source of [
      `Sub A()\n${"Open ".repeat(200_000)}\nEnd Sub`,
      `Sub A()\n${"x = 1 & _\n".repeat(200_000)}End Sub`,
      `Sub A()\n    s = "${"a".repeat(2_000_000)}"\nEnd Sub`,
      `Sub A()\n${'s = "pass" & "Password=" & "x" & '.repeat(20_000)}\nEnd Sub`,
    ]) {
      const { ms } = timed(() => analyzeVbaProject(project(source), { host: "excel", includeSource: true }));
      expect(ms).toBeLessThan(LIMIT_MS);
    }
  });

  it("プロシージャ・呼び出し・依存が大量にあっても、呼び出し関係の集計と仕様書の作成が終わる", () => {
    const n = 20_000;
    const source = [
      `Sub Main()\n${Array.from({ length: n }, (_, i) => `    P${i}\n    Kill "C:\\\\tmp\\\\${i}.txt"`).join("\n")}\nEnd Sub`,
      ...Array.from({ length: n }, (_, i) => `Sub P${i}()\n    Main\nEnd Sub`),
    ].join("\n");
    const { value: a, ms } = timed(() => analyzeVbaProject(project(source), { host: "excel", includeSource: false }));
    expect(a.callGraph.length).toBe(2 * n);
    expect(ms).toBeLessThan(LIMIT_MS * 2);
    const report = analyzeBuffer(buildXlsm({ modules: [{ name: "Module1", type: "standard", code: source }] }), "big.xlsm", { includeSource: false });
    const md = timed(() => renderMarkdown(report));
    expect(md.value).toContain("ほか");
    expect(md.ms).toBeLessThan(LIMIT_MS * 2);
  });

  it("parseModuleSource は継続行の上限を超えたら新しい論理行にする", () => {
    const m = parseModuleSource(`Sub A()\n${"x _\n".repeat(1000)}End Sub`);
    expect(m.procedures[0].endLine).toBe(1002);
    expect(m.lines.length).toBeGreaterThan(10);
  });
});

describe("Access(mdb-reader)のページのつながりの循環", () => {
  it("テーブル定義のページが自分自身を指していても、制限時間で止まる", () => {
    const data = new Uint8Array(readFileSync(fileURLToPath(new URL("./fixtures/access/queryTestV2010.accdb", import.meta.url))));
    const bad = Uint8Array.from(data);
    expect(bad[2 * 4096]).toBe(0x02); // 2ページ目は MSysObjects のテーブル定義
    new DataView(bad.buffer).setUint32(2 * 4096 + 4, 2, true); // 次のページ = 自分自身
    const { value: e, ms } = timed(() => catchError(() => analyzeBuffer(bad, "loop.accdb", { limits: { timeLimitMs: 1000 } })));
    expect(e).toBeInstanceOf(LimitExceededError);
    expect((e as LimitExceededError).kind).toBe("time");
    expect(ms).toBeLessThan(5000);
  });

  it("暗号化の設定で鍵導出の回数が異常に大きいファイルは、計算を始める前に止める", () => {
    const data = new Uint8Array(readFileSync(fileURLToPath(new URL("./fixtures/access/queryTestV2010.accdb", import.meta.url))));
    const bad = Uint8Array.from(data);
    bad.set(new TextEncoder().encode('spinCount="4000000000"'), 3000);
    expect(catchError(() => analyzeBuffer(bad, "a.accdb"))).toBeInstanceOf(CorruptFileError);
  });
});

describe("Budget", () => {
  it("件数の上限を超えたら警告を出して打ち切る", () => {
    const warnings: string[] = [];
    expect(new Budget().cap([1, 2, 3], 2, warnings, "シート")).toEqual([1, 2]);
    expect(warnings).toEqual(["シートが 3 件あり上限(2 件)を超えるため、先頭の 2 件だけを解析しました"]);
  });

  it("壊れた入力でも上限以内なら非圧縮の zip も読める", () => {
    expect(analyzeBuffer(restoreZip(xlsm), "a.xlsm").stats.procedureCount).toBe(16);
  });
});
