import { beforeAll, describe, expect, it } from "vitest";
import type { Inquiry } from "../domain/inquiry";
import { DEMO_SCENARIOS } from "../demo/scenarios";
import { buildQuoteDocument, buildReplyEmail } from "../documents";
import { approveQuote, registerInquiry, runEstimate } from "../pipeline";
import { loadReferenceData, type ReferenceData } from "../reference/load";
import { DATA_DIR, sampleFile, TEST_TODAY, testDeps } from "../test-helpers";
import { calculateQuote } from "./calculate";
import { quoteWarnings } from "./warnings";

let ref: ReferenceData;
let revision: Inquiry;
let shortLead: Inquiry;

async function estimated(index: number) {
  const deps = testDeps();
  const s = DEMO_SCENARIOS[index];
  const i = await registerInquiry(deps, { email: s.buildEmail(TEST_TODAY), files: s.drawings.map((d) => sampleFile(d.fileName)) });
  return { deps, inquiry: await runEstimate(deps, i.id) };
}

beforeAll(async () => {
  ref = await loadReferenceData(DATA_DIR);
  revision = (await estimated(0)).inquiry;
  shortLead = (await estimated(2)).inquiry;
});

function warningsFor(inquiry: Inquiry, overrides: { input?: Inquiry["quote"]; today?: string; rates?: ReferenceData["rates"] } = {}) {
  const input = overrides.input?.input ?? inquiry.quote!.input;
  const rates = overrides.rates ?? ref.rates;
  return quoteWarnings({
    spec: inquiry.extraction.spec,
    input,
    result: calculateQuote(input, rates),
    similar: inquiry.similar!.cases,
    cases: ref.cases,
    rates,
    company: ref.company,
    today: overrides.today ?? TEST_TODAY,
    assumptions: inquiry.estimate!.assumptions,
  }).map((w) => w.message);
}

describe("quoteWarnings", () => {
  it("仮計算の前提、旧版の赤字と不具合を警告する", () => {
    const w = warningsFor(revision);
    expect(w).toContain("熱処理の要否が未確定のため、熱処理なしで計算しています");
    expect(w.some((m) => m.includes("赤字の可能性"))).toBe(true);
    expect(w.some((m) => m.includes("不具合:寸法不良(めっき後)"))).toBe(true);
  });

  it("短納期は特急料金を計上した旨を出し、外すと警告に変わる", () => {
    expect(warningsFor(shortLead).some((m) => m.includes("特急料金を計上しています"))).toBe(true);
    const input = { ...shortLead.quote!.input, expedite: false };
    expect(warningsFor(shortLead, { input: { input, updatedAt: "" } }).some((m) => m.includes("特急料金を外しています"))).toBe(true);
  });

  it("±0.005の公差で研削工程がなければ確認を促す", () => {
    const input = { ...shortLead.quote!.input, processes: shortLead.quote!.input.processes.filter((p) => p.processId !== "cyl_grinding") };
    expect(warningsFor(shortLead, { input: { input, updatedAt: "" } }).some((m) => m.includes("研削工程の要否"))).toBe(true);
    expect(warningsFor(shortLead).some((m) => m.includes("研削工程の要否"))).toBe(false);
  });

  it("類似案件の単価から大きく外れたら警告する", () => {
    const input = { ...revision.quote!.input, profitRate: 1 };
    expect(warningsFor(revision, { input: { input, updatedAt: "" } }).some((m) => m.includes("よく似た過去案件の単価"))).toBe(true);
  });

  it("単価表が古ければ警告する", () => {
    expect(warningsFor(revision, { today: "2027-06-01" }).some((m) => m.includes("単価表"))).toBe(true);
  });

  it("設備の加工範囲を超える大きさなら警告する", () => {
    const input = structuredClone(revision.quote!.input);
    input.material.dimensions = { shape: "block", lengthMm: 900, widthMm: 750, heightMm: 30, diameterMm: null };
    expect(warningsFor(revision, { input: { input, updatedAt: "" } }).some((m) => m.includes("設備の加工範囲"))).toBe(true);
  });
});

describe("見積書と回答メール", () => {
  it("承認前は下書きとして現在の入力から計算し、承認後は承認時の金額を使う", async () => {
    const { deps, inquiry } = await estimated(0);
    const draft = buildQuoteDocument(inquiry, ref.rates)!;
    expect(draft.approved).toBe(false);
    expect(draft.subtotal).toBe(calculateQuote(inquiry.quote!.input, ref.rates).total);
    const approved = await approveQuote(deps, inquiry.id, "代表取締役 白石", { acknowledgeUnconfirmed: true });
    const doc = buildQuoteDocument(approved, ref.rates)!;
    expect(doc).toMatchObject({ approved: true, subtotal: approved.approved!.total, issuedOn: TEST_TODAY, validUntil: "2026-11-18" });
    expect(doc.tax).toBe(Math.floor(doc.subtotal * 0.1));
  });

  it("回答メールに金額・納期・確認事項を入れる", () => {
    const doc = buildQuoteDocument(revision, ref.rates)!;
    const mail = buildReplyEmail({ inquiry: revision, doc, company: ref.company, customer: ref.customers[0] });
    expect(mail).toContain("ミナモト装置工業株式会社 購買部 北川様");
    expect(mail).toContain(`・合計:${doc.subtotal.toLocaleString("ja-JP")}円(税抜`);
    expect(mail).toContain("に納入できる見込みです(確定納期は受注時にご連絡いたします)");
    expect(mail).not.toContain("納入可能です");
    expect(mail).toContain("1. 図面注記4に「熱処理:要否は別途指示」");
  });

  it("短納期は特急対応として納期に答える", () => {
    const doc = buildQuoteDocument(shortLead, ref.rates)!;
    expect(doc.expedite).toBe(true);
    expect(doc.meetsDueDate).toBe(true);
    const mail = buildReplyEmail({ inquiry: shortLead, doc, company: ref.company, customer: null });
    // 生産負荷を踏まえた納期確約はしないので、特急でも「可能です」と断定しない
    expect(mail).toContain("に向けて特急対応で調整いたします(確定納期は受注時にご連絡いたします)");
    expect(mail).not.toContain("納入可能です");
  });
});
