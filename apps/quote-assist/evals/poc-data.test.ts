import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { DEMO_SCENARIOS } from "@/lib/demo/scenarios";
import { loadReferenceData, type ReferenceData } from "@/lib/reference/load";
import { DATA_DIR, SAMPLES_DIR } from "@/lib/test-helpers";
import { exportDemoDataset } from "./demo-dataset";
import { parseCsvRecords, toCsv } from "./lib/csv";
import { loadPocDataset, parseDimensions, parseQuestionFields, PocDataError } from "./poc-data";

let ref: ReferenceData;
beforeAll(async () => {
  ref = await loadReferenceData(DATA_DIR);
});

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "poc-data-"));
const TODAY = "2026-10-19";

describe("寸法の書き方", () => {
  it("角物・丸物・板物と、省略した書き方を Dimensions にする", () => {
    expect(parseDimensions("block:120x60x25")).toEqual({ shape: "block", lengthMm: 120, widthMm: 60, heightMm: 25, diameterMm: null });
    expect(parseDimensions("120 × 60 × 25")).toEqual({ shape: "block", lengthMm: 120, widthMm: 60, heightMm: 25, diameterMm: null });
    expect(parseDimensions("round:20x180")).toEqual({ shape: "round", lengthMm: 180, widthMm: null, heightMm: null, diameterMm: 20 });
    expect(parseDimensions("Φ20x180")).toEqual({ shape: "round", lengthMm: 180, widthMm: null, heightMm: null, diameterMm: 20 });
    expect(parseDimensions("板物:200x100xt2")).toEqual({ shape: "sheet", lengthMm: 200, widthMm: 100, heightMm: 2, diameterMm: null });
  });

  it("数が合わない・数値でない・範囲外は、書き方を示して失敗する", () => {
    expect(() => parseDimensions("120x60")).toThrow("3 つの数値");
    expect(() => parseDimensions("round:20x180x5")).toThrow("2 つの数値");
    expect(() => parseDimensions("abc")).toThrow("読めません");
    expect(() => parseDimensions("block:99999x1x1")).toThrow("範囲外");
  });
});

describe("確認すべき項目", () => {
  it("項目名・日本語・その他を、項目のキーにそろえる", () => {
    expect(parseQuestionFields("material; 熱処理；検査書類;other")).toEqual(["material", "heatTreatment", "inspection", "other"]);
    expect(parseQuestionFields("")).toEqual([]);
    expect(() => parseQuestionFields("ぶひん")).toThrow("分かりません");
  });
});

describe("PoC のデータの読み込み", () => {
  it("デモ用の3件を書き出して読み込むと、正解ラベル・確認事項・参考案件がそのまま戻る", () => {
    const dir = tmp();
    exportDemoDataset(dir, ref, SAMPLES_DIR, TODAY);
    const cases = loadPocDataset(dir, ref);
    expect(cases.map((c) => c.id)).toEqual(DEMO_SCENARIOS.map((s) => s.id));
    DEMO_SCENARIOS.forEach((s, i) => {
      const { expectedQuestions, ...truth } = s.truth;
      expect(cases[i].truth).toEqual(truth);
      expect(cases[i].expectedQuestions).toEqual(expectedQuestions);
      expect(cases[i].email.body).toBe(s.buildEmail(TODAY).body);
      expect(cases[i].drawings.length).toBe(new Set(s.drawings.map((d) => d.fileName)).size);
      expect(cases[i].receivedAt).toBe(TODAY);
    });
    // 同じ図番の台帳の案件(MS-24017 の旧版)が参考案件になる
    expect(cases[0].similarCaseIds).toEqual(["Q-2025-0185"]);
    // 希望納期・検査書類の列がないので、評価しない
    expect(cases[0].truth.dueDate).toBeUndefined();
    expect(cases[0].truth.inspection).toBeUndefined();
  });

  it("日本語の列名・希望納期と検査書類の列・Shift_JIS の CSV も読める", () => {
    const dir = tmp();
    exportDemoDataset(dir, ref, SAMPLES_DIR, TODAY);
    const { headers, records } = parseCsvRecords(fs.readFileSync(path.join(dir, "cases.csv"), "utf8"));
    const jp: Record<string, string> = { id: "案件ID", part_name: "品名", drawing_number: "図番", drawings: "図面ファイル", material: "材質" };
    const rows = [[...headers.map((h) => jp[h] ?? h), "希望納期", "検査書類"], ...records.map((r, i) => [...headers.map((h) => r[h]), i === 0 ? "2026-11-30" : "", i === 0 ? "検査成績書" : ""])];
    fs.writeFileSync(path.join(dir, "cases.csv"), toCsv(rows));
    const cases = loadPocDataset(dir, ref);
    expect(cases[0].truth.dueDate).toBe("2026-11-30");
    expect(cases[0].truth.inspection).toBe("検査成績書");
    expect(cases[1].truth.dueDate).toBeNull();
    expect(cases[1].truth.inspection).toBeNull();
  });

  it("問題はすべて集めて、行番号つきで一度に報告する(材質・処理が単価表にない・図面がない・PDFでない・id重複・台帳にない案件)", () => {
    const dir = tmp();
    exportDemoDataset(dir, ref, SAMPLES_DIR, TODAY);
    fs.writeFileSync(path.join(dir, "drawings", "fake.pdf"), "not a pdf");
    const { headers, records } = parseCsvRecords(fs.readFileSync(path.join(dir, "cases.csv"), "utf8"));
    const bad = records.map((r) => ({ ...r }));
    bad[0].material = "ユニオブタニウム";
    bad[0].drawings = "no-such.pdf";
    bad[1].drawings = "fake.pdf";
    bad[1].surface_treatment = "金メッキ";
    bad[2].id = bad[1].id;
    bad[0].similar_case_ids = "Q-9999-9999";
    fs.writeFileSync(path.join(dir, "cases.csv"), toCsv([headers, ...bad.map((r) => headers.map((h) => r[h]))]));
    let message = "";
    try {
      loadPocDataset(dir, ref);
    } catch (e) {
      expect(e).toBeInstanceOf(PocDataError);
      message = (e as Error).message;
    }
    expect(message).toContain("2行目");
    expect(message).toContain("ユニオブタニウム");
    expect(message).toContain("no-such.pdf がありません");
    expect(message).toContain("PDFではありません");
    expect(message).toContain("金メッキ");
    expect(message).toContain("id が重複");
    expect(message).toContain("Q-9999-9999");
  });

  it("必須の列がない・cases.csv がない・drawings/ の外のファイルは失敗する", () => {
    const empty = tmp();
    expect(() => loadPocDataset(empty, ref)).toThrow("cases.csv がありません");
    fs.writeFileSync(path.join(empty, "cases.csv"), "id,品名\nx,y\n");
    expect(() => loadPocDataset(empty, ref)).toThrow("必須の列がありません: drawings, drawing_number, revision");
    const dir = tmp();
    exportDemoDataset(dir, ref, SAMPLES_DIR, TODAY);
    const { headers, records } = parseCsvRecords(fs.readFileSync(path.join(dir, "cases.csv"), "utf8"));
    records[0].drawings = "../cases.csv";
    fs.writeFileSync(path.join(dir, "cases.csv"), toCsv([headers, ...records.map((r) => headers.map((h) => r[h]))]));
    expect(() => loadPocDataset(dir, ref)).toThrow("外のファイルは指定できません");
  });

  it("知らない列は警告して無視する", () => {
    const dir = tmp();
    exportDemoDataset(dir, ref, SAMPLES_DIR, TODAY);
    const { headers, records } = parseCsvRecords(fs.readFileSync(path.join(dir, "cases.csv"), "utf8"));
    fs.writeFileSync(path.join(dir, "cases.csv"), toCsv([[...headers, "メモ"], ...records.map((r) => [...headers.map((h) => r[h]), "x"])]));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadPocDataset(dir, ref)).toHaveLength(3);
    expect(warn.mock.calls[0][0]).toContain("メモ");
    warn.mockRestore();
  });
});
