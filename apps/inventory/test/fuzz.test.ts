// 壊れた・切り詰められたファイルのファジング。顧客から受け取った不明なファイルを解析するため、
// どの入力でも「想定したエラー(InventoryError)で止まる」か「結果を返す」のどちらかで、ハングやクラッシュがないことを確かめる。
// 乱数はシードで決まるので、失敗したら同じシード・回数で再現できる(FUZZ_ITERATIONS で回数を増やせる)。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeBuffer, InventoryError, LimitExceededError, renderMarkdown } from "../src";
import { factsText } from "../src/doc/ai";
import { decompressContainer, VbaFormatError } from "../src/vba/decompress";
import { parseDirStream } from "../src/vba/dir";
import { buildDirStream, compress } from "./helpers/ovba";
import { mutate, restoreZip, rng, storedRange } from "./helpers/fuzz";
import { SAMPLE_PROJECT } from "./helpers/sampleVba";
import { buildXls, buildXlsb, buildXlsm } from "./helpers/workbooks";

const ITERATIONS = Number(process.env.FUZZ_ITERATIONS ?? 120);
/** 1件あたりの制限時間(エンジン内の協調的な時間切れ)と、それを含めた実時間の上限 */
const LIMITS = { timeLimitMs: 2_000 };
const WALL_CLOCK_MS = 4_000;

interface Outcome {
  ok: number;
  errors: Map<string, number>;
}

/** 1件を解析し、想定外の例外・時間超過があればテストを失敗させる */
function analyzeSafely(bytes: Uint8Array, name: string, how: string, outcome: Outcome) {
  const started = performance.now();
  try {
    const report = analyzeBuffer(bytes, name, { limits: LIMITS, now: new Date(0) });
    // 結果が返ったなら、仕様書・AI への入力も作れること
    renderMarkdown(report);
    factsText(report);
    outcome.ok++;
  } catch (e) {
    if (!(e instanceof InventoryError)) {
      throw new Error(`${name}(${how}): 想定外の例外 ${(e as Error)?.name}: ${(e as Error)?.message}`);
    }
    // メモリを確保できない(巨大な配列の確保)は上限で止めるべきもの
    expect(e.message, `${name}(${how})`).not.toMatch(/メモリを確保できません/);
    outcome.errors.set(e.name, (outcome.errors.get(e.name) ?? 0) + 1);
  }
  const elapsed = performance.now() - started;
  expect(elapsed, `${name}(${how}) の処理時間`).toBeLessThan(WALL_CLOCK_MS);
}

function fuzz(name: string, base: Uint8Array, seed: number, region?: { start: number; end: number }) {
  const r = rng(seed);
  const outcome: Outcome = { ok: 0, errors: new Map() };
  for (let i = 0; i < ITERATIONS; i++) {
    const { bytes, how } = mutate(base, r, region);
    analyzeSafely(bytes, name, `seed=${seed} #${i}: ${how}`, outcome);
  }
  return outcome;
}

const accessFixture = (name: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/access/${name}`, import.meta.url))));

describe("ファジング: 壊れたファイルでもハング・クラッシュしない", { timeout: 300_000 }, () => {
  it(".xlsm(非圧縮の zip に詰め直して、XML と vbaProject.bin を直接壊す)", () => {
    const xlsm = restoreZip(buildXlsm(SAMPLE_PROJECT));
    const all = fuzz("売上管理.xlsm", xlsm, 1);
    const vba = fuzz("売上管理.xlsm", xlsm, 2, storedRange(xlsm, "xl/vbaProject.bin"));
    const sheet = fuzz("売上管理.xlsm", xlsm, 3, storedRange(xlsm, "xl/worksheets/sheet1.xml"));
    // 壊し方によっては結果を返す(警告付き)ことも、エラーで止まることもある
    expect(all.ok + vba.ok + sheet.ok).toBeGreaterThan(0);
    expect(vba.ok).toBeGreaterThan(0);
  });

  it(".xlsm(圧縮されたままの zip を壊す)", () => {
    fuzz("売上管理.xlsm", buildXlsm(SAMPLE_PROJECT), 4);
  });

  it(".xlsb", () => {
    const xlsb = restoreZip(buildXlsb(SAMPLE_PROJECT));
    fuzz("売上.xlsb", xlsb, 5);
    fuzz("売上.xlsb", xlsb, 6, storedRange(xlsb, "xl/workbook.bin"));
  });

  it(".xls(OLE 複合ファイル。FAT・ディレクトリ・BIFF レコードを壊す)", () => {
    const xls = buildXls(SAMPLE_PROJECT);
    fuzz("古い集計.xls", xls, 7);
    // 先頭のヘッダ・FAT・ディレクトリのあたりを集中的に壊す
    fuzz("古い集計.xls", xls, 8, { start: 0, end: 2048 });
  });

  it("Access(.accdb / .mdb)", () => {
    for (const [i, name] of ["queryTestV2010.accdb", "queryTestV2003.mdb", "linkerTestV2007.accdb", "odbcLinkerTestV2007.accdb"].entries()) {
      const data = accessFixture(name);
      fuzz(name, data, 100 + i, { start: 0, end: Math.min(data.length, 64 * 1024) });
      fuzz(name, data, 200 + i);
    }
  });

  it("でたらめなバイト列(先頭だけ各形式の署名)", () => {
    const r = rng(9);
    const outcome: Outcome = { ok: 0, errors: new Map() };
    const heads = [
      [0x50, 0x4b, 0x03, 0x04],
      [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
      [0x00, 0x01, 0x00, 0x00, ...new TextEncoder().encode("Standard ACE DB")],
      [0x00, 0x01, 0x00, 0x00, ...new TextEncoder().encode("Standard Jet DB")],
    ];
    for (let i = 0; i < ITERATIONS; i++) {
      const head = r.pick(heads);
      const bytes = Uint8Array.from({ length: head.length + r.int(20_000) }, (_, j) => (j < head.length ? head[j] : r.int(256)));
      analyzeSafely(bytes, "random.bin", `#${i}`, outcome);
    }
    expect(outcome.ok).toBe(0);
  });
});

describe("ファジング: MS-OVBA の解凍と dir ストリーム", { timeout: 120_000 }, () => {
  it("壊れた圧縮データは VbaFormatError / LimitExceededError か、上限以内の結果になる", () => {
    const r = rng(10);
    const text = new TextEncoder().encode(Array.from({ length: 300 }, (_, i) => `Sub P${i}()\r\n  MsgBox "${i}"\r\nEnd Sub\r\n`).join(""));
    const packed = compress(text);
    for (let i = 0; i < ITERATIONS * 5; i++) {
      const { bytes } = mutate(packed, r);
      try {
        const out = decompressContainer(bytes, 0, 1024 * 1024);
        expect(out.length).toBeLessThanOrEqual(1024 * 1024);
      } catch (e) {
        expect(e instanceof VbaFormatError || e instanceof LimitExceededError).toBe(true);
      }
    }
  });

  it("壊れた dir ストリームは VbaFormatError か結果になる", () => {
    const r = rng(11);
    const dir = buildDirStream(SAMPLE_PROJECT, [10, 20, 30, 40, 50]);
    for (let i = 0; i < ITERATIONS * 5; i++) {
      const { bytes } = mutate(dir, r);
      try {
        const info = parseDirStream(bytes);
        expect(Array.isArray(info.modules)).toBe(true);
      } catch (e) {
        expect(e).toBeInstanceOf(VbaFormatError);
      }
    }
  });
});
