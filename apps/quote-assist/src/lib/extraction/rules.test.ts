import { beforeAll, describe, expect, it } from "vitest";
import type { ExtractedField, Question, Spec } from "../domain/inquiry";
import { loadReferenceData, type ReferenceData } from "../reference/load";
import { DATA_DIR, TEST_TODAY } from "../test-helpers";
import { emptyExtraction } from "./demo";
import { normalizeExtraction } from "./normalize";
import { applyRules, buildQuestionEmail, REQUIRED_FIELDS, unconfirmedFields } from "./rules";

let ref: ReferenceData;
beforeAll(async () => {
  ref = await loadReferenceData(DATA_DIR);
});

const baseSpec: Spec = {
  customerId: "C01",
  customerName: "ミナモト装置工業株式会社",
  contactName: "購買部 北川",
  partName: "センサブラケット",
  drawingNumber: "MS-24017",
  revision: "C",
  materialId: "SUS304",
  materialCandidates: [],
  quantity: 50,
  dimensions: { shape: "block", lengthMm: 120, widthMm: 60, heightMm: 25, diameterMm: null },
  toleranceMm: 0.01,
  surfaceTreatmentId: "electroless_ni",
  surfaceTreatmentCandidates: [],
  heatTreatmentId: "none",
  heatTreatmentCandidates: [],
  dueDate: "2026-11-27",
  inspection: "不要",
  processType: "milling",
  features: [],
  notes: [],
};

const source = { document: "MS-24017_C_1.pdf", page: 1, location: "表題欄", quote: "SUS304" };

// 既定は「確信度 高・根拠あり」の読み取り結果
function drafts(over: Partial<Record<ExtractedField["key"], Partial<ExtractedField>>> = {}) {
  const n = normalizeExtraction(emptyExtraction(""), { rates: ref.rates, customers: ref.customers, from: "" });
  return n.fields.map((f) => ({ ...f, confidence: "high" as const, sources: [source], ...over[f.key] }));
}

describe("applyRules", () => {
  it("すべてそろっていれば確認事項はない", () => {
    const r = applyRules(baseSpec, drafts(), [], { rates: ref.rates, today: TEST_TODAY });
    expect(r.questions).toEqual([]);
    expect(r.fields.every((f) => f.status === "ok")).toBe(true);
  });

  it("必須項目が欠けていれば missing にし、定型の質問文で確認事項にする", () => {
    const spec = { ...baseSpec, heatTreatmentId: null, inspection: null, quantity: null };
    const r = applyRules(spec, drafts(), [], { rates: ref.rates, today: TEST_TODAY });
    expect(r.fields.filter((f) => f.status === "missing").map((f) => f.key)).toEqual(["quantity", "heatTreatment", "inspection"]);
    expect(r.questions.map((q) => [q.field, q.origin])).toEqual([
      ["quantity", "rule"],
      ["heatTreatment", "rule"],
      ["inspection", "rule"],
    ]);
  });

  it("AIの質問文があればそれを使う", () => {
    const ai: Question = { field: "heatTreatment", issue: "注記4で保留", question: "熱処理は必要でしょうか。", origin: "ai" };
    const r = applyRules({ ...baseSpec, heatTreatmentId: null }, drafts(), [ai], { rates: ref.rates, today: TEST_TODAY });
    expect(r.questions).toEqual([ai]);
  });

  it("確信度が低いだけの項目は社内での要確認にとどめ、顧客には聞かない", () => {
    const r = applyRules(baseSpec, drafts({ partName: { confidence: "low" } }), [], { rates: ref.rates, today: TEST_TODAY });
    expect(r.fields.find((f) => f.key === "partName")!.status).toBe("review");
    expect(r.questions).toEqual([]);
  });

  it("確信度が高くても、根拠(記載箇所)のない値は要確認にする。顧客には聞かない", () => {
    const r = applyRules(baseSpec, drafts({ quantity: { sources: [] }, tolerance: { sources: [] } }), [], { rates: ref.rates, today: TEST_TODAY });
    expect(r.fields.find((f) => f.key === "quantity")!.status).toBe("review");
    // 公差は値(±0.01)があるので根拠が要る
    expect(r.fields.find((f) => f.key === "tolerance")!.status).toBe("review");
    expect(r.questions).toEqual([]);
    // 普通公差のみ(値なし)なら根拠がなくてよい
    const plain = applyRules({ ...baseSpec, toleranceMm: null }, drafts({ tolerance: { sources: [] } }), [], { rates: ref.rates, today: TEST_TODAY });
    expect(plain.fields.find((f) => f.key === "tolerance")!.status).toBe("ok");
  });

  it("顧客マスタとメールのドメインで照合できた顧客名は、記載箇所がなくてもよい", () => {
    const r = applyRules(baseSpec, drafts({ customerName: { sources: [] } }), [], { rates: ref.rates, today: TEST_TODAY });
    expect(r.fields.find((f) => f.key === "customerName")!.status).toBe("ok");
    const unknown = applyRules({ ...baseSpec, customerId: null }, drafts({ customerName: { sources: [] } }), [], { rates: ref.rates, today: TEST_TODAY });
    expect(unknown.fields.find((f) => f.key === "customerName")!.status).toBe("review");
  });

  it("unconfirmedFields:要確認・不足の項目と理由を返す(見積の画面と承認で使う)", () => {
    const r = applyRules(
      { ...baseSpec, inspection: null, dueDate: "2026-10-01" },
      drafts({ quantity: { sources: [], confidence: "low" }, partName: { confidence: "low" } }),
      [],
      { rates: ref.rates, today: TEST_TODAY },
    );
    expect(unconfirmedFields(r.fields)).toEqual([
      { key: "partName", label: "品名", status: "review", reason: "確信度 低" },
      { key: "quantity", label: "数量", status: "review", reason: "確信度 低・根拠の記載なし" },
      { key: "dueDate", label: "希望納期", status: "review", reason: "希望納期(2026年10月1日)が受付日より前です" },
      { key: "inspection", label: "検査書類", status: "missing", reason: "不足(図面・メールに記載なし)" },
    ]);
    expect(unconfirmedFields(applyRules(baseSpec, drafts(), [], { rates: ref.rates, today: TEST_TODAY }).fields)).toEqual([]);
  });

  it("人が修正した項目は確信度や正規化の問題を引き継がない", () => {
    const r = applyRules(
      baseSpec,
      drafts({ material: { confidence: "low", issue: "アルミ系", editedByHuman: true } }),
      [{ field: "material", issue: "", question: "材質は?", origin: "ai" }],
      { rates: ref.rates, today: TEST_TODAY },
    );
    const f = r.fields.find((x) => x.key === "material")!;
    expect(f.status).toBe("ok");
    expect(f.editedByHuman).toBe(true);
    expect(r.questions).toEqual([]);
  });

  it("希望納期が受付日より前なら要確認", () => {
    const r = applyRules({ ...baseSpec, dueDate: "2026-10-01" }, drafts(), [], { rates: ref.rates, today: TEST_TODAY });
    const f = r.fields.find((x) => x.key === "dueDate")!;
    expect(f.status).toBe("review");
    expect(f.issue).toContain("受付日より前");
    expect(r.questions.map((q) => q.field)).toEqual(["dueDate"]);
  });

  it("材質に合わない表面処理(ステンレスにアルマイト)は要確認", () => {
    const r = applyRules({ ...baseSpec, surfaceTreatmentId: "white_anodize" }, drafts(), [], { rates: ref.rates, today: TEST_TODAY });
    expect(r.fields.find((x) => x.key === "surfaceTreatment")!.issue).toContain("通常行いません");
  });

  it("AIの「その他」の確認事項は残す", () => {
    const other: Question = { field: "other", issue: "", question: "梱包の指定はございますか。", origin: "ai" };
    const r = applyRules(baseSpec, drafts(), [other], { rates: ref.rates, today: TEST_TODAY });
    expect(r.questions).toEqual([other]);
  });

  it("必須項目の一覧", () => {
    expect(REQUIRED_FIELDS).toContain("heatTreatment");
    expect(REQUIRED_FIELDS).not.toContain("tolerance");
  });
});

describe("buildQuestionEmail", () => {
  it("宛先・品名・番号つきの質問・差出人を入れる", () => {
    const text = buildQuestionEmail(
      baseSpec,
      [
        { field: "heatTreatment", issue: "", question: "熱処理は必要でしょうか。", origin: "ai" },
        { field: "inspection", issue: "", question: "検査成績書は必要でしょうか。", origin: "rule" },
      ],
      ref.company,
    );
    expect(text).toContain("ミナモト装置工業株式会社 購買部 北川様");
    expect(text).toContain("センサブラケット(MS-24017 Rev.C)");
    expect(text).toContain("1. 熱処理は必要でしょうか。\n2. 検査成績書は必要でしょうか。");
    expect(text).toContain("株式会社しらかば精工 営業部 青木");
  });
});
