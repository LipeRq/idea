import { beforeAll, describe, expect, it } from "vitest";
import { DEMO_SCENARIOS } from "../demo/scenarios";
import { evaluateExtraction } from "../evaluate";
import { loadReferenceData, type ReferenceData } from "../reference/load";
import { DATA_DIR, TEST_TODAY } from "../test-helpers";
import { emptyExtraction } from "./demo";
import { matchCustomer, matchMaterial, matchTreatment, normalizeExtraction, normalizeText } from "./normalize";
import { applyRules } from "./rules";
import type { ExtractionOutput } from "./schema";

let ref: ReferenceData;
beforeAll(async () => {
  ref = await loadReferenceData(DATA_DIR);
});

describe("matchMaterial", () => {
  it.each([
    ["SUS304", "SUS304"],
    ["ｓｕｓ３０４", "SUS304"],
    ["SUS 304", "SUS304"],
    ["A5052P", "A5052"],
    ["S45C-D", "S45C"],
    ["真鍮", "C3604"],
    ["ステンレス304", "SUS304"],
  ])("「%s」→ %s", (raw, id) => {
    expect(matchMaterial(raw, ref.rates)).toEqual({ id, candidates: [], issue: null });
  });

  it("「アルミ」は系統だけ分かるので、候補を挙げて要確認にする", () => {
    const m = matchMaterial("アルミ", ref.rates);
    expect(m.id).toBeNull();
    expect(m.candidates).toEqual(["A5052", "A6061", "A7075"]);
    expect(m.issue).toContain("アルミ系");
  });

  it("単価表にない材質は要確認", () => {
    const m = matchMaterial("チタン", ref.rates);
    expect(m.id).toBeNull();
    expect(m.issue).toContain("単価表にない");
  });

  it("記載がなければ問題なしの null", () => {
    expect(matchMaterial(null, ref.rates)).toEqual({ id: null, candidates: [], issue: null });
  });
});

describe("matchTreatment", () => {
  it.each([
    ["無電解ニッケルめっき 5μm", "surface", "electroless_ni"],
    ["無電解Niめっき", "surface", "electroless_ni"],
    ["白アルマイト", "surface", "white_anodize"],
    ["硬質アルマイト 20μm", "surface", "hard_anodize"],
    ["黒染め", "surface", "black_oxide"],
    ["高周波焼入れ HRC50〜55(軸受部)", "heat", "induction_hardening"],
    ["調質", "heat", "quench_temper"],
  ] as const)("「%s」→ %s", (raw, kind, id) => {
    expect(matchTreatment(raw, ref.rates, kind).id).toBe(id);
  });

  it.each(["なし", "不要", "—", "-", "ー"])("「%s」は「なし」と明記", (raw) => {
    expect(matchTreatment(raw, ref.rates, "heat")).toEqual({ id: "none", candidates: [], issue: null });
  });

  it("「アルマイト」だけでは種類が決まらない", () => {
    const t = matchTreatment("アルマイト", ref.rates, "surface");
    expect(t.id).toBeNull();
    expect(t.candidates).toEqual(["white_anodize", "black_anodize", "hard_anodize"]);
    expect(t.issue).toContain("種類が決まっていません");
  });

  it("表面処理と熱処理を取り違えない", () => {
    expect(matchTreatment("高周波焼入れ", ref.rates, "surface").id).toBeNull();
  });
});

describe("matchCustomer", () => {
  it("差出人のドメインで照合する", () => {
    expect(matchCustomer(null, "someone@minamoto-sochi.example", ref.customers)?.id).toBe("C01");
  });
  it("社名の「株式会社」の位置や全角・半角が違っても照合する", () => {
    expect(matchCustomer("すずかけ搬送システム(株)", "x@other.example", ref.customers)?.id).toBe("C05");
  });
  it("マスタにない会社は null(新規)", () => {
    expect(matchCustomer("株式会社こもれび機工", "minami@komorebi-kiko.example", ref.customers)).toBeNull();
  });
});

describe("normalizeExtraction", () => {
  const from = "x@unknown.example";

  it("範囲外の数量・寸法・不正な日付は値を捨てる", () => {
    const out: ExtractionOutput = {
      ...emptyExtraction(""),
      quantity: { value: 0, raw: "0", confidence: "high", sources: [], note: null },
      dimensions: {
        value: { shape: "block", lengthMm: -1, widthMm: 10, heightMm: 10, diameterMm: null },
        raw: null,
        confidence: "high",
        sources: [],
        note: null,
      },
      dueDate: { value: "2026-02-30", raw: null, confidence: "high", sources: [], note: null },
    };
    const n = normalizeExtraction(out, { rates: ref.rates, customers: ref.customers, from });
    expect(n.spec.quantity).toBeNull();
    expect(n.spec.dimensions).toBeNull();
    expect(n.spec.dueDate).toBeNull();
  });

  it("丸物の寸法は直径と長さだけを残す", () => {
    const out: ExtractionOutput = {
      ...emptyExtraction(""),
      dimensions: {
        value: { shape: "round", lengthMm: 180, widthMm: 20, heightMm: 20, diameterMm: 20 },
        raw: null,
        confidence: "high",
        sources: [],
        note: null,
      },
    };
    const n = normalizeExtraction(out, { rates: ref.rates, customers: ref.customers, from });
    expect(n.spec.dimensions).toEqual({ shape: "round", lengthMm: 180, widthMm: null, heightMm: null, diameterMm: 20 });
    expect(n.spec.processType).toBe("turning");
  });

  it("選択肢にない値(確信度・形状・加工種別・確認事項の項目)は安全な値に丸める", () => {
    const out: ExtractionOutput = {
      ...emptyExtraction(""),
      material: { value: "SUS304", raw: null, confidence: "高", sources: [], note: null },
      dimensions: {
        value: { shape: "cube", lengthMm: 10, widthMm: 10, heightMm: 10, diameterMm: null },
        raw: null,
        confidence: "high",
        sources: [],
        note: null,
      },
      processType: { value: "casting", raw: null, confidence: "high", sources: [], note: null },
      questions: [{ field: "price", issue: "", question: "単価のご希望は?" }],
    };
    const n = normalizeExtraction(out, { rates: ref.rates, customers: ref.customers, from });
    expect(n.fields.find((f) => f.key === "material")!.confidence).toBe("low");
    expect(n.spec.dimensions).toBeNull();
    expect(n.spec.processType).toBeNull();
    expect(n.aiQuestions[0].field).toBe("other");
  });

  it("長すぎる文字列は切り詰め、全角英数字はそろえる", () => {
    const out: ExtractionOutput = {
      ...emptyExtraction("あ".repeat(500)),
      drawingNumber: { value: "ｍｓ－２４０１７", raw: null, confidence: "high", sources: [], note: null },
    };
    const n = normalizeExtraction(out, { rates: ref.rates, customers: ref.customers, from });
    expect(n.summary.length).toBe(300);
    expect(n.spec.drawingNumber).toBe(normalizeText("ｍｓ－２４０１７").toUpperCase());
  });

  // デモ用の3件は、正解ラベルどおりに正規化され、確認すべき項目がすべて確認事項に挙がる
  it.each(DEMO_SCENARIOS.map((s) => [s.label, s] as const))("%s:正解ラベルと一致", (_, s) => {
    const email = s.buildEmail(TEST_TODAY);
    const n = normalizeExtraction(s.buildExtraction({ emailBody: email.body, today: TEST_TODAY }), {
      rates: ref.rates,
      customers: ref.customers,
      from: email.from,
    });
    const { questions } = applyRules(n.spec, n.fields, n.aiQuestions, { rates: ref.rates, today: TEST_TODAY });
    const result = evaluateExtraction(n.spec, questions, s.truth);
    expect(result.fields.filter((f) => !f.correct)).toEqual([]);
    expect(result.missedQuestions).toEqual([]);
  });
});
