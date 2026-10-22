import { beforeAll, describe, expect, it } from "vitest";
import { DEMO_SCENARIOS } from "@/lib/demo/scenarios";
import type { Inquiry, Question } from "@/lib/domain/inquiry";
import { registerInquiry } from "@/lib/pipeline";
import { loadReferenceData, type ReferenceData } from "@/lib/reference/load";
import { DATA_DIR, sampleFile, testDeps, TEST_TODAY } from "@/lib/test-helpers";
import { demoCases } from "./run";
import { aggregate, ruleSearchTop5, scoreCase, scoreFields, scoreQuestions, scoreSimilar, searchPool, specFromTruth, type CaseScore, type FieldScore } from "./score";

let ref: ReferenceData;
let inquiry: Inquiry;
const scenario = DEMO_SCENARIOS[0];
beforeAll(async () => {
  ref = await loadReferenceData(DATA_DIR);
  // デモの固定結果(精度100%)を、本物の読み取り・正規化の流れで作る
  inquiry = await registerInquiry(testDeps(), { email: scenario.buildEmail(TEST_TODAY), files: scenario.drawings.map((d) => sampleFile(d.fileName)) });
});

const truth = () => demoCases(ref, undefined, TEST_TODAY)[0].truth;
const clone = (): Inquiry => structuredClone(inquiry);

describe("項目ごとの採点", () => {
  it("オラクル: 正解ラベルどおりの読み取りは全項目が正解で、確からしさが付く", () => {
    const fields = scoreFields(inquiry, truth());
    expect(fields).toHaveLength(9);
    expect(fields.every((f) => f.correct)).toBe(true);
    expect(fields.find((f) => f.key === "material")!.confidence).toBe("high");
  });

  it("ヌル: 何も読み取れなかった結果は、正解ラベルのある項目がほぼ不正解で、確からしさ「低」になる", () => {
    const empty = clone();
    empty.extraction.spec = { ...empty.extraction.spec, partName: null, drawingNumber: null, revision: null, materialId: null, quantity: null, dimensions: null, toleranceMm: null, surfaceTreatmentId: null, heatTreatmentId: null };
    const fields = scoreFields(empty, truth());
    // 熱処理の正解は「記載なし(null)」なので、何も読み取らないのが正解になる
    expect(fields.filter((f) => !f.correct).map((f) => f.key)).toEqual(["partName", "drawingNumber", "revision", "material", "quantity", "dimensions", "tolerance", "surfaceTreatment"]);
  });

  it("誤りと確からしさを結び付けられる(高なのに誤り = 自信のある誤り)", () => {
    const t = clone();
    t.extraction.spec = { ...t.extraction.spec, materialId: "SS400", quantity: 51 };
    const quantityField = t.extraction.fields.find((f) => f.key === "quantity")!;
    quantityField.confidence = "low";
    const fields = scoreFields(t, truth());
    const material = fields.find((f) => f.key === "material")!;
    const quantity = fields.find((f) => f.key === "quantity")!;
    expect(material).toMatchObject({ correct: false, confidence: "high", expected: "SUS304", actual: "SS400" });
    expect(quantity).toMatchObject({ correct: false, confidence: "low" });
    const agg = aggregate([{ caseId: "x", kind: null, score: { fields, questions: scoreQuestions([], []), similar: [] } }]);
    expect(agg.confidentErrors).toEqual([{ caseId: "x", key: "material", expected: "SUS304", actual: "SS400" }]);
  });

  it("希望納期・検査書類は、正解の列があるときだけ評価する(検査書類は包含で照合)", () => {
    const t = clone();
    t.extraction.spec = { ...t.extraction.spec, dueDate: "2026-11-30", inspection: "検査成績書(寸法・材質)" };
    const fields = scoreFields(t, { ...truth(), dueDate: "2026-11-30", inspection: "検査成績書" });
    expect(fields.find((f) => f.key === "dueDate")!.correct).toBe(true);
    expect(fields.find((f) => f.key === "inspection")!.correct).toBe(true);
    const wrong = scoreFields(t, { ...truth(), dueDate: "2026-12-01", inspection: null });
    expect(wrong.find((f) => f.key === "dueDate")!.correct).toBe(false);
    expect(wrong.find((f) => f.key === "inspection")!.correct).toBe(false);
  });
});

const q = (field: Question["field"], origin: Question["origin"] = "ai"): Question => ({ field, issue: "", question: "", origin });

describe("確認事項の採点", () => {
  it("検出(正解のうち挙がった項目)・漏れ・不要(正解にない項目)を数え、「その他」は不要に数えない", () => {
    const s = scoreQuestions([q("heatTreatment"), q("surfaceTreatment", "rule"), q("other"), q("heatTreatment")], ["heatTreatment", "inspection"]);
    expect(s.found).toEqual(["heatTreatment"]);
    expect(s.missed).toEqual(["inspection"]);
    expect(s.unnecessary).toEqual([{ field: "surfaceTreatment", origin: "rule" }]);
    expect(s.otherAsked).toBe(1);
    expect(s.asked).toEqual(["heatTreatment", "surfaceTreatment"]);
  });
});

describe("類似検索の採点", () => {
  it("参考案件が上位5件の何位に入ったかと、1位・上位3件・上位5件の的中", () => {
    const top5 = ["a", "b", "c", "d", "e"];
    expect(scoreSimilar("rule_extracted", top5, ["c", "z"])).toMatchObject({ ranks: { c: 3, z: null }, hitAny: true, hitTop1: false, hitTop3: true, listedInTop5: 1 });
    expect(scoreSimilar("rule_extracted", top5, ["z"])).toMatchObject({ hitAny: false, hitTop3: false, listedInTop5: 0 });
    expect(scoreSimilar("rule_extracted", top5, ["a"])).toMatchObject({ hitTop1: true });
  });

  it("その案件自身は検索先から除く(答えが混ざらない)。デモでは同じ図番の旧版が1位に来る", () => {
    const spec = inquiry.extraction.spec;
    const withOwn = ruleSearchTop5(spec, ref, null);
    expect(withOwn).toContain("Q-2025-0185");
    expect(ruleSearchTop5(spec, ref, "Q-2025-0185")).not.toContain("Q-2025-0185");
    expect(searchPool(ref, "Q-2025-0185")).toHaveLength(ref.cases.length - 1);
  });

  it("正解の仕様で検索するときは、読み取りの誤りを正解で上書きする", () => {
    const bad = { ...inquiry.extraction.spec, materialId: "SS400", drawingNumber: null };
    const spec = specFromTruth(bad, truth());
    expect(spec).toMatchObject({ materialId: "SUS304", drawingNumber: "MS-24017", partName: "センサブラケット" });
  });

  it("scoreCase: 参考案件の正解があれば2つの検索方法で採点し、AIの並べ替え後の上位5件があれば3つ目も採点する", () => {
    const poc = { ...demoCases(ref, undefined, TEST_TODAY)[0], similarCaseIds: ["Q-2025-0185"] };
    const two = scoreCase({ poc, inquiry, ref, aiTop5: null });
    expect(two.similar.map((s) => s.mode)).toEqual(["rule_extracted", "rule_truth"]);
    expect(two.similar.every((s) => s.hitAny)).toBe(true);
    const three = scoreCase({ poc, inquiry, ref, aiTop5: ["x", "Q-2025-0185"] });
    expect(three.similar.map((s) => s.mode)).toEqual(["rule_extracted", "rule_truth", "ai_rerank"]);
    expect(three.similar[2].ranks).toEqual({ "Q-2025-0185": 2 });
    expect(scoreCase({ poc: { ...poc, similarCaseIds: [] }, inquiry, ref, aiTop5: null }).similar).toEqual([]);
  });
});

const field = (key: string, correct: boolean, confidence: FieldScore["confidence"]): FieldScore => ({ key, expected: "e", actual: correct ? "e" : "a", correct, confidence, status: null });
const score = (fields: FieldScore[], questions = scoreQuestions([], []), similar: CaseScore["similar"] = []): CaseScore => ({ fields, questions, similar });

describe("集計", () => {
  const rows = [
    { caseId: "c1", kind: "新規", score: score([field("material", false, "high"), field("quantity", true, "high"), field("tolerance", false, "low")], scoreQuestions([q("heatTreatment"), q("surfaceTreatment", "rule")], ["heatTreatment", "inspection"]), [scoreSimilar("rule_extracted", ["a", "b"], ["b"])]) },
    { caseId: "c2", kind: "新規", score: score([field("material", true, "medium"), field("quantity", true, "high"), field("tolerance", true, "high")], scoreQuestions([q("inspection")], ["inspection"]), [scoreSimilar("rule_extracted", ["a"], ["z"])]) },
    { caseId: "c3", kind: "リピート", score: score([field("material", true, "high")], scoreQuestions([], [])) },
  ];
  const a = aggregate(rows);

  it("項目別・全体の正解率", () => {
    expect(a.fields.find((f) => f.key === "material")!.rate).toMatchObject({ k: 2, n: 3 });
    expect(a.overall).toMatchObject({ k: 5, n: 7 });
  });

  it("確からしさ別の誤りと、自信のある誤りの一覧", () => {
    expect(a.confidence.find((c) => c.level === "high")).toMatchObject({ n: 5, wrong: 1 });
    expect(a.confidence.find((c) => c.level === "low")).toMatchObject({ n: 1, wrong: 1 });
    expect(a.confidentErrors).toHaveLength(1);
    expect(a.confidentErrors[0]).toMatchObject({ caseId: "c1", key: "material" });
  });

  it("確認事項の検出率・的中率・不要な確認事項・漏れ", () => {
    const qs = a.questions;
    expect(qs.recall).toMatchObject({ k: 2, n: 3 });
    expect(qs.precision).toMatchObject({ k: 2, n: 3 });
    expect(qs.unnecessaryTotal).toBe(1);
    expect(qs.unnecessaryByOrigin).toEqual({ ai: 0, rule: 1 });
    expect(qs.unnecessaryPerCase).toBeCloseTo(1 / 3, 9);
    expect(qs.missed).toEqual([{ caseId: "c1", field: "inspection" }]);
    expect(qs.allFoundCases).toMatchObject({ k: 1, n: 2 });
  });

  it("類似検索の的中率は、参考案件の正解がある案件だけが対象", () => {
    expect(a.similar).toHaveLength(1);
    expect(a.similar[0]).toMatchObject({ mode: "rule_extracted", evaluated: 2 });
    expect(a.similar[0].hitAny).toMatchObject({ k: 1, n: 2 });
    expect(a.similar[0].hitTop3).toMatchObject({ k: 1, n: 2 });
    expect(a.similar[0].listedRecall).toMatchObject({ k: 1, n: 2 });
  });

  it("種類別の集計", () => {
    expect(a.byKind.find((k) => k.kind === "新規")).toMatchObject({ n: 2, confidentErrors: 1 });
    expect(a.byKind.find((k) => k.kind === "リピート")).toMatchObject({ n: 1, confidentErrors: 0 });
  });

  it("案件がないときも落ちない", () => {
    const empty = aggregate([]);
    expect(empty.overall.rate).toBeNull();
    expect(empty.questions.unnecessaryPerCase).toBeNull();
  });
});
