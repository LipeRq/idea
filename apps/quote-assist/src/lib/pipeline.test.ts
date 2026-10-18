import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_SCENARIOS } from "./demo/scenarios";
import type { Deps } from "./deps";
import {
  approveQuote,
  deleteInquiry,
  PipelineError,
  registerInquiry,
  registerToCrm,
  runEstimate,
  saveQuote,
  unapproveQuote,
  updateExtraction,
  validateUpload,
} from "./pipeline";
import { calculateQuote } from "./quote/calculate";
import { sampleFile, TEST_TODAY, testDeps } from "./test-helpers";

const { streamMock } = vi.hoisted(() => ({ streamMock: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    beta = { messages: { stream: streamMock } };
  },
}));

const [revision, missingInfo] = DEMO_SCENARIOS;

async function register(deps: Deps, s = revision) {
  return registerInquiry(deps, { email: s.buildEmail(TEST_TODAY), files: s.drawings.map((d) => sampleFile(d.fileName)) });
}

let deps: Deps;
beforeEach(() => {
  deps = testDeps();
  streamMock.mockReset();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("validateUpload", () => {
  const pdf = sampleFile("KM-3305_A.pdf");
  it.each([
    ["PDFでないファイル", [{ name: "a.png", data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]) }], "本文", 400],
    ["4ファイル以上", [pdf, pdf, pdf, pdf], "本文", 400],
    ["10MBを超えるファイル", [{ name: "big.pdf", data: new Uint8Array(10 * 1024 * 1024 + 1).fill(0x25) }], "本文", 413],
    ["メール本文も図面もない", [], "  ", 400],
    ["2万文字を超える本文", [pdf], "あ".repeat(20_001), 413],
  ])("%s は受け付けない", (_, files, body, status) => {
    try {
      validateUpload(files, body);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PipelineError);
      expect((e as PipelineError).status).toBe(status);
    }
  });
});

describe("registerInquiry(デモモード)", () => {
  it("図面を保存し、抽出・正規化・必須項目チェックの結果と処理時間を記録する", async () => {
    const inquiry = await register(deps);
    expect(inquiry.status).toBe("extracted");
    expect(inquiry.extraction.mode).toBe("demo");
    expect(inquiry.drawings.map((d) => d.fileName)).toEqual(["MS-24017_C_1.pdf", "MS-24017_C_2.pdf"]);
    expect(inquiry.drawings[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await deps.storage.blobs.get(inquiry.drawings[0].blobKey)).toEqual(sampleFile("MS-24017_C_1.pdf").data);

    const spec = inquiry.extraction.spec;
    expect(spec).toMatchObject({ customerId: "C01", materialId: "SUS304", quantity: 50, toleranceMm: 0.01, surfaceTreatmentId: "electroless_ni" });
    expect(inquiry.extraction.questions.map((q) => q.field)).toEqual(["heatTreatment", "inspection"]);
    expect(inquiry.metrics.map((m) => [m.step, m.mode])).toEqual([
      ["extract", "demo"],
      ["rules", "rule"],
    ]);
    expect(await deps.storage.inquiries.get(inquiry.id)).toEqual(inquiry);
  });
});

describe("registerInquiry(AIモード、SDKはモック)", () => {
  it("AIの結果を使い、トークン数と概算費用を記録する", async () => {
    const email = revision.buildEmail(TEST_TODAY);
    streamMock.mockReturnValue({
      finalMessage: () =>
        Promise.resolve({
          stop_reason: "end_turn",
          parsed_output: revision.buildExtraction({ emailBody: email.body, today: TEST_TODAY }),
          model: "claude-opus-5-5",
          usage: { input_tokens: 10_000, output_tokens: 2_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        }),
    });
    const inquiry = await register({ ...deps, aiMode: "anthropic" });
    expect(inquiry.extraction.mode).toBe("ai");
    const m = inquiry.metrics.find((x) => x.step === "extract")!;
    expect(m.usage).toEqual({ inputTokens: 10_000, outputTokens: 2_000, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 });
    // 10,000×$4/M + 2,000×$20/M = $0.08
    expect(m.costUsd).toBeCloseTo(0.08, 6);
  });

  it("AIが失敗しても登録は止めず、全項目を要入力にしてエラーを知らせる(内容は返さない)", async () => {
    streamMock.mockReturnValue({ finalMessage: () => Promise.reject(new Error("secret upstream detail")) });
    const inquiry = await register({ ...deps, aiMode: "anthropic" });
    expect(inquiry.extraction.mode).toBe("failed");
    expect(inquiry.extraction.error).toContain("失敗しました");
    expect(JSON.stringify(inquiry)).not.toContain("secret upstream detail");
    expect(inquiry.extraction.fields.find((f) => f.key === "material")!.status).toBe("missing");
  });
});

describe("見積の流れ(検索→修正→承認→CRM登録)", () => {
  it("類似案件の検索と、類似実績からの工数案・見積入力を作る", async () => {
    const { id } = await register(deps);
    const inquiry = await runEstimate(deps, id);
    expect(inquiry.status).toBe("estimated");
    expect(inquiry.similar!.cases).toHaveLength(5);
    expect(inquiry.estimate!.mode).toBe("fallback");
    expect(inquiry.quote!.input).toEqual(inquiry.estimate!.proposal);
    expect(inquiry.quote!.input.treatments).toEqual([{ treatmentId: "electroless_ni", unitPriceOverride: null }]);
    expect(inquiry.estimate!.assumptions).toEqual(["熱処理の要否が未確定のため、熱処理なしで計算しています"]);
    expect(inquiry.metrics.map((m) => m.step)).toEqual(["extract", "rules", "search", "estimate", "calculate"]);
  });

  it("情報不足の引き合いでも、仮の値で計算し、その旨を残す", async () => {
    const { id } = await register(deps, missingInfo);
    const inquiry = await runEstimate(deps, id);
    expect(inquiry.quote!.input.material.materialId).toBe("A5052");
    expect(inquiry.quote!.input.quantity).toBe(1);
    expect(inquiry.estimate!.assumptions.join("\n")).toContain("材質が未確定");
    expect(inquiry.estimate!.assumptions.join("\n")).toContain("数量が未確定");
  });

  it("AIの工数案と並べ替えを使う(SDKはモック)", async () => {
    const { id } = await register(deps);
    const aiDeps = { ...deps, aiMode: "anthropic" as const };
    const probe = await runEstimate(deps, id);
    const [first, second] = probe.similar!.cases;
    streamMock.mockReturnValue({
      finalMessage: () =>
        Promise.resolve({
          stop_reason: "end_turn",
          parsed_output: {
            ranking: [{ caseId: second.caseId, reason: "AIの理由" }],
            processes: [{ processId: "mc", setupHours: 1, cycleHoursPerPiece: 1.3, basisCaseIds: [first.caseId], rationale: "旧版の実績" }],
            risks: ["リスク"],
            internalMemo: "メモ",
          },
          model: "claude-opus-5-5",
          usage: { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        }),
    });
    const inquiry = await runEstimate(aiDeps, id);
    expect(inquiry.estimate!.mode).toBe("ai");
    expect(inquiry.similar!.mode).toBe("ai");
    expect(inquiry.similar!.cases[0]).toMatchObject({ caseId: second.caseId, aiReason: "AIの理由" });
    expect(inquiry.quote!.input.processes).toEqual([
      { processId: "mc", setupHours: 1, cycleHoursPerPiece: 1.3, chargeOverride: null, source: { kind: "ai", caseIds: [first.caseId], note: null } },
    ]);
    expect(inquiry.metrics.find((m) => m.step === "estimate")!.mode).toBe("ai");
  });

  it("AIの工数案が失敗したら類似実績からの工数案で続ける", async () => {
    const { id } = await register(deps);
    streamMock.mockReturnValue({ finalMessage: () => Promise.reject(new Error("timeout")) });
    const inquiry = await runEstimate({ ...deps, aiMode: "anthropic" }, id);
    expect(inquiry.estimate!.mode).toBe("fallback");
    expect(inquiry.quote!.input.processes.length).toBeGreaterThan(0);
  });

  it("人が工数を直すと出典を「人」にし、AI案との差を記録する", async () => {
    const { id } = await register(deps);
    const estimated = await runEstimate(deps, id);
    const input = structuredClone(estimated.quote!.input);
    const mc = input.processes.find((p) => p.processId === "mc")!;
    const before = mc.cycleHoursPerPiece;
    mc.cycleHoursPerPiece = 1.2;
    const saved = await saveQuote(deps, id, input);
    const savedMc = saved.quote!.input.processes.find((p) => p.processId === "mc")!;
    expect(savedMc.source.kind).toBe("human");
    expect(savedMc.source.caseIds).toEqual(mc.source.caseIds);
    expect(saved.reviewLog).toEqual([
      expect.objectContaining({ kind: "quote", key: "process:mc:cycle", before: String(before), after: "1.2" }),
    ]);
    // 変えていない工程はAI案(類似実績)の出典のまま
    expect(saved.quote!.input.processes.find((p) => p.processId === "deburr")!.source.kind).toBe("fallback");
  });

  it("単価表にない工程は保存しない", async () => {
    const { id } = await register(deps);
    const estimated = await runEstimate(deps, id);
    const input = structuredClone(estimated.quote!.input);
    input.processes[0].processId = "unknown";
    await expect(saveQuote(deps, id, input)).rejects.toMatchObject({ status: 400 });
  });

  it("承認すると金額を確定し、承認後は修正できない。取り消せば戻る", async () => {
    const { id } = await register(deps);
    const estimated = await runEstimate(deps, id);
    const approved = await approveQuote(deps, id, "代表取締役 白石");
    const ref = await deps.reference();
    const expected = calculateQuote(estimated.quote!.input, ref.rates);
    expect(approved.status).toBe("approved");
    expect(approved.approved).toMatchObject({ total: expected.total, unitPrice: expected.unitPrice, rateTableId: ref.rates.id });
    expect(approved.approved!.quoteNumber).toMatch(/^QA-20261019-[0-9A-F]{4}$/);
    await expect(saveQuote(deps, id, estimated.quote!.input)).rejects.toMatchObject({ status: 409 });
    await expect(updateExtraction(deps, id, { quantity: 10 })).rejects.toMatchObject({ status: 409 });
    const reopened = await unapproveQuote(deps, id);
    expect(reopened.status).toBe("estimated");
    expect(reopened.approved).toBeNull();
  });

  it("CRMへは承認後に1回だけ登録できる", async () => {
    const { id } = await register(deps);
    await runEstimate(deps, id);
    await expect(registerToCrm(deps, id)).rejects.toMatchObject({ status: 409 });
    await approveQuote(deps, id);
    const registered = await registerToCrm(deps, id);
    expect(registered.status).toBe("registered");
    expect(registered.crm).toMatchObject({ provider: "mock", opportunityId: "006MK0000000001AAA", quoteId: "0Q0MK0000000001AAA" });
    const records = await deps.storage.mockCrm.list();
    expect(records).toHaveLength(1);
    expect(records[0].opportunity).toMatchObject({ Id: "006MK0000000001AAA", Amount: registered.approved!.total });
    await expect(registerToCrm(deps, id)).rejects.toMatchObject({ status: 409 });
    await expect(unapproveQuote(deps, id)).rejects.toMatchObject({ status: 409 });
  });

  it("CRMのエラーは定型文で返す", async () => {
    const { id } = await register(deps);
    await runEstimate(deps, id);
    await approveQuote(deps, id);
    const failing = { ...deps, crm: { provider: "salesforce" as const, label: "x", register: () => Promise.reject(new Error("token=abc")) } };
    const error = await registerToCrm(failing, id).catch((e) => e);
    expect(error).toMatchObject({ status: 502 });
    expect(error.message).not.toContain("token=abc");
  });
});

describe("updateExtraction", () => {
  it("人の修正を反映し、確認事項を作り直し、修正前後を記録する。類似検索はやり直しにする", async () => {
    const { id } = await register(deps);
    await runEstimate(deps, id);
    const updated = await updateExtraction(deps, id, { heatTreatment: "none", inspection: "検査成績書(寸法)要" });
    expect(updated.extraction.questions).toEqual([]);
    expect(updated.extraction.fields.find((f) => f.key === "heatTreatment")).toMatchObject({
      status: "ok",
      editedByHuman: true,
      display: "なし",
    });
    expect(updated.reviewLog.map((l) => [l.key, l.before, l.after])).toEqual([
      ["heatTreatment", "(空欄)", "なし"],
      ["inspection", "(空欄)", "検査成績書(寸法)要"],
    ]);
    expect(updated.status).toBe("extracted");
    expect(updated.similar).toBeNull();
    expect(updated.quote).toBeNull();
  });

  it("単価表にない材質には直せない", async () => {
    const { id } = await register(deps);
    await expect(updateExtraction(deps, id, { material: "チタン" })).rejects.toMatchObject({ status: 400 });
  });

  it("値が変わらなければ見積をやり直さない", async () => {
    const { id } = await register(deps);
    await runEstimate(deps, id);
    const updated = await updateExtraction(deps, id, { quantity: 50 });
    expect(updated.status).toBe("estimated");
    expect(updated.reviewLog).toEqual([]);
  });
});

it("削除すると図面の本体も消す", async () => {
  const inquiry = await register(deps);
  await deleteInquiry(deps, inquiry.id);
  expect(await deps.storage.inquiries.get(inquiry.id)).toBeNull();
  expect(await deps.storage.blobs.get(inquiry.drawings[0].blobKey)).toBeNull();
});
