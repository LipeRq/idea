import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_SCENARIOS } from "../demo/scenarios";
import type { Deps } from "../deps";
import type { BaselineRow } from "../domain/impact";
import { approveQuote, recordOutcome, registerInquiry, runEstimate, saveQuote } from "../pipeline";
import { sampleFile, TEST_TODAY, testDeps } from "../test-helpers";
import { baselineRowToRecord, countEstimatedRows } from "./baseline-records";
import { inquiryToRecord, quoteAdoption } from "./records";

const [revision] = DEMO_SCENARIOS;
let deps: Deps;

beforeEach(() => {
  deps = testDeps();
  vi.spyOn(console, "info").mockImplementation(() => {});
});

async function approved(options: { operator?: string; editMc?: boolean } = {}) {
  const { id } = await registerInquiry(deps, {
    email: revision.buildEmail(TEST_TODAY),
    files: revision.drawings.map((d) => sampleFile(d.fileName)),
    operator: options.operator,
  });
  const estimated = await runEstimate(deps, id);
  if (options.editMc) {
    const input = structuredClone(estimated.quote!.input);
    input.processes.find((p) => p.processId === "mc")!.cycleHoursPerPiece = 1.2;
    await saveQuote(deps, id, input);
  }
  return approveQuote(deps, id, "代表取締役 白石", { acknowledgeUnconfirmed: true });
}

describe("baselineRowToRecord", () => {
  const row: BaselineRow = {
    receivedAt: "2026-07-06",
    customer: "A",
    partName: "B",
    kind: null,
    drawingCount: null,
    estimator: " 工場長 森 ",
    salesMinutes: 15,
    estimatorMinutes: null,
    answeredAt: "2026-07-09",
    customerInquiry: null,
    result: "won",
    memo: "営業の時間は推定",
    orderAmount: null,
    quotedCost: null,
    actualCost: null,
    reworkCount: null,
  };
  it("作業時間は営業・事務と見積担当の合計(片方が空欄なら0分)。両方空欄なら欠損", () => {
    expect(baselineRowToRecord(row, 0).workMinutes).toBe(15);
    expect(baselineRowToRecord({ ...row, estimatorMinutes: 45 }, 0).workMinutes).toBe(60);
    expect(baselineRowToRecord({ ...row, salesMinutes: null }, 0).workMinutes).toBeNull();
  });
  it("作成者は前後の空白を除く。空なら null。AIの値は持たない", () => {
    const r = baselineRowToRecord(row, 2);
    expect(r).toMatchObject({ id: "baseline-3", operator: "工場長 森", aiUsed: false, adoption: [] });
    expect(baselineRowToRecord({ ...row, estimator: "" }, 0).operator).toBeNull();
  });
  it("メモに「推定」がある行を数える", () => {
    expect(countEstimatedRows([row, { ...row, memo: "" }])).toBe(1);
  });
});

describe("inquiryToRecord(見積アシストの記録から)", () => {
  it("承認前は回答日・作業時間・採用率を持たない", async () => {
    const { id } = await registerInquiry(deps, { email: revision.buildEmail(TEST_TODAY), files: revision.drawings.map((d) => sampleFile(d.fileName)), operator: " 営業部 青木 " });
    const r = inquiryToRecord((await deps.storage.inquiries.get(id))!);
    expect(r).toMatchObject({ receivedAt: TEST_TODAY, answeredAt: null, workMinutes: null, operator: "営業部 青木", adoption: [], aiUsed: false, aiCostJpy: null });
  });

  it("承認後は、承認日・経過分・項目別の採用状況・見積原価を持つ(修正がなければ全項目を採用)", async () => {
    const inquiry = await approved({ operator: "営業部 青木" });
    const r = inquiryToRecord(inquiry);
    expect(r.answeredAt).toBe(TEST_TODAY);
    expect(r.workMinutes).toBe(0);
    // 抽出13項目+見積6項目(工数は工程ごと)。デモの抽出に手修正はない
    expect(r.adoption.filter((a) => a.item.startsWith("field:"))).toHaveLength(13);
    expect(r.adoption.every((a) => a.modified === 0)).toBe(true);
    const hours = r.adoption.find((a) => a.item === "quote:hours")!;
    expect(hours.evaluated).toBe(inquiry.approved!.input.processes.length);
    expect(r.hourChangeRates).toEqual([]);
    // 見積原価は、承認した明細から利益と端数処理を除いた合計
    const lines = inquiry.approved!.lines;
    const expected = lines.filter((l) => l.kind !== "profit" && l.kind !== "rounding").reduce((s, l) => s + l.amount, 0);
    expect(r.quotedCost).toBe(expected);
    expect(r.quotedCost!).toBeLessThan(inquiry.approved!.total);
  });

  it("工数を直すと、その工程が「修正」になり、修正幅(|修正後−案|÷案)を持つ", async () => {
    const inquiry = await approved({ editMc: true });
    const r = inquiryToRecord(inquiry);
    const mcBefore = inquiry.estimate!.proposal.processes.find((p) => p.processId === "mc")!.cycleHoursPerPiece;
    const hours = r.adoption.find((a) => a.item === "quote:hours")!;
    expect(hours.modified).toBe(1);
    expect(r.hourChangeRates).toHaveLength(1);
    expect(r.hourChangeRates[0]).toBeCloseTo(Math.abs(1.2 - mcBefore) / mcBefore, 10);
  });

  it("受注・実績原価・手戻りの記録を写す。受注額は承認した合計。失注なら受注額なし", async () => {
    const inquiry = await approved();
    const won = await recordOutcome(deps, inquiry.id, { result: "won", actualCost: 123_456, reworkCount: 1 });
    expect(inquiryToRecord(won)).toMatchObject({ result: "won", orderAmount: inquiry.approved!.total, actualCost: 123_456, reworkCount: 1 });
    const lost = await recordOutcome(deps, inquiry.id, { result: "lost", actualCost: null, reworkCount: null });
    expect(inquiryToRecord(lost)).toMatchObject({ result: "lost", orderAmount: null, actualCost: null });
    await expect(recordOutcome(deps, inquiry.id, { result: "lost", actualCost: 1, reworkCount: null })).rejects.toMatchObject({ status: 400 });
    expect(inquiryToRecord(await recordOutcome(deps, inquiry.id, null)).result).toBeNull();
  });

  it("承認前は結果を記録できない", async () => {
    const { id } = await registerInquiry(deps, { email: revision.buildEmail(TEST_TODAY), files: revision.drawings.map((d) => sampleFile(d.fileName)) });
    await expect(recordOutcome(deps, id, { result: "won", actualCost: null, reworkCount: null })).rejects.toMatchObject({ status: 409 });
  });
});

describe("quoteAdoption", () => {
  it("人が追加・削除した工程は「修正」。数量・利益率・特急・表面処理の変更もそれぞれ数える", async () => {
    const inquiry = await approved();
    const proposal = inquiry.estimate!.proposal;
    const final = structuredClone(proposal);
    final.quantity += 1;
    final.profitRate = Math.min(1, final.profitRate + 0.05);
    final.expedite = !final.expedite;
    final.treatments = [];
    const removed = final.processes.pop()!;
    final.processes.push({ ...removed, processId: removed.processId, setupHours: removed.setupHours });
    final.processes.shift();
    const { adoption } = quoteAdoption(proposal, final);
    const get = (k: string) => adoption.find((a) => a.item === k)!;
    expect(get("quote:quantity").modified).toBe(1);
    expect(get("quote:profitRate").modified).toBe(1);
    expect(get("quote:expedite").modified).toBe(1);
    expect(get("quote:material").modified).toBe(0);
    // 先頭の工程を外したので、工数のうち少なくとも1工程が修正
    expect(get("quote:hours").modified).toBeGreaterThanOrEqual(1);
    expect(get("quote:hours").evaluated).toBe(proposal.processes.length);
  });
});
