import type { Confidence, Inquiry, Question, Spec } from "@/lib/domain/inquiry";
import type { PastCase } from "@/lib/domain/reference";
import { evaluateExtraction } from "@/lib/evaluate";
import { normalizeText } from "@/lib/extraction/normalize";
import type { ReferenceData } from "@/lib/reference/load";
import { buildCaseQuery, searchSimilarCases } from "@/lib/similar/search";
import { rateOf, type Rate } from "./lib/stats";
import type { PocCase, PocTruth } from "./poc-data";

// 抽出・確認事項・類似検索の採点(決定的。API は呼ばない)。poc-plan.md 4章の指標に対応する:
//  1 読み取りの正解率(項目別) / 2 自信のある誤り(確からしさ「高」なのに誤り) / 3 確認事項の検出率と不要な確認事項 / 4 類似検索の的中率

export type FieldScore = { key: string; expected: string; actual: string; correct: boolean; confidence: Confidence | null; status: string | null };

export type QuestionScore = {
  asked: string[];
  expected: string[];
  found: string[];
  missed: string[];
  unnecessary: { field: string; origin: Question["origin"] }[];
  /** 項目が「その他」の確認事項の数(正解に項目がないので、不要とは数えない) */
  otherAsked: number;
};

export type SimilarMode = "rule_extracted" | "rule_truth" | "ai_rerank";
export const SIMILAR_MODE_LABEL: Record<SimilarMode, string> = {
  rule_extracted: "ルール検索(AIの読み取り結果で検索)",
  rule_truth: "ルール検索(正解の仕様で検索。検索だけの精度)",
  ai_rerank: "AIの並べ替え後(--with-estimate。画面に出る上位5件)",
};

export type SimilarScore = { mode: SimilarMode; listed: string[]; top5: string[]; ranks: Record<string, number | null>; hitAny: boolean; hitTop1: boolean; hitTop3: boolean; listedInTop5: number };

export type CaseScore = { fields: FieldScore[]; questions: QuestionScore; similar: SimilarScore[] };

const show = (v: unknown) => (v === null || v === undefined ? "(なし)" : String(v));

/** 9項目(既存の evaluateExtraction)に、希望納期・検査書類を足して、項目ごとの確からしさを付ける */
export function scoreFields(inquiry: Inquiry, truth: PocTruth): FieldScore[] {
  const { spec } = inquiry.extraction;
  const base = evaluateExtraction(spec, inquiry.extraction.questions, { ...truth, expectedQuestions: [] } as Parameters<typeof evaluateExtraction>[2]).fields;
  const rows = base.map((f) => ({ ...f }));
  if (truth.dueDate !== undefined) rows.push({ key: "dueDate", expected: show(truth.dueDate), actual: show(spec.dueDate), correct: (truth.dueDate ?? null) === (spec.dueDate ?? null) });
  if (truth.inspection !== undefined) {
    const a = spec.inspection === null ? null : normalizeText(spec.inspection);
    const e = truth.inspection === null ? null : normalizeText(truth.inspection);
    // 書き方の違い(「検査成績書」と「検査成績書(寸法)」など)は、どちらかがどちらかを含めば正解とする
    rows.push({ key: "inspection", expected: show(truth.inspection), actual: show(spec.inspection), correct: a === e || (a !== null && e !== null && (a.includes(e) || e.includes(a))) });
  }
  const byKey = new Map(inquiry.extraction.fields.map((f) => [f.key as string, f]));
  return rows.map((f) => ({ ...f, confidence: byKey.get(f.key)?.confidence ?? null, status: byKey.get(f.key)?.status ?? null }));
}

export function scoreQuestions(questions: Question[], expectedQuestions: string[]): QuestionScore {
  const expected = [...new Set(expectedQuestions.filter((f) => f !== "other"))];
  const asked: string[] = [...new Set<string>(questions.map((q) => q.field).filter((f) => f !== "other"))];
  const found = expected.filter((f) => asked.includes(f));
  const unnecessary = asked.filter((f) => !expected.includes(f)).map((field) => ({ field, origin: questions.find((q) => q.field === field)!.origin }));
  return { asked, expected, found, missed: expected.filter((f) => !asked.includes(f)), unnecessary, otherAsked: questions.filter((q) => q.field === "other").length };
}

export function scoreSimilar(mode: SimilarMode, top5: string[], listed: string[]): SimilarScore {
  const ranks = Object.fromEntries(listed.map((id) => [id, top5.includes(id) ? top5.indexOf(id) + 1 : null]));
  const rankValues = Object.values(ranks).filter((r): r is number => r !== null);
  return {
    mode,
    listed,
    top5,
    ranks,
    hitAny: rankValues.length > 0,
    hitTop1: rankValues.some((r) => r === 1),
    hitTop3: rankValues.some((r) => r <= 3),
    listedInTop5: rankValues.length,
  };
}

/** 抽出結果の上に、正解の値を重ねた仕様(検索そのものの精度を、読み取りの誤りから切り離して測る) */
export function specFromTruth(extracted: Spec, truth: PocTruth): Spec {
  const dimensions = truth.dimensions ?? extracted.dimensions;
  return {
    ...extracted,
    partName: truth.partName,
    drawingNumber: truth.drawingNumber,
    revision: truth.revision,
    materialId: truth.materialId,
    quantity: truth.quantity,
    dimensions,
    toleranceMm: truth.toleranceMm,
    surfaceTreatmentId: truth.surfaceTreatmentId,
    heatTreatmentId: truth.heatTreatmentId,
    processType: extracted.processType ?? (dimensions?.shape === "round" ? "turning" : dimensions?.shape === "sheet" ? "sheet" : dimensions ? "milling" : null),
  };
}

/** 台帳から、その案件自身を除いた検索先(答えが混ざらないように) */
export function searchPool(ref: ReferenceData, ownCaseId: string | null): PastCase[] {
  return ref.cases.filter((c) => c.id !== ownCaseId);
}

export function ruleSearchTop5(spec: Spec, ref: ReferenceData, ownCaseId: string | null): string[] {
  return searchSimilarCases(buildCaseQuery(spec, ref.rates), searchPool(ref, ownCaseId), ref.rates, ref.defects)
    .slice(0, 5)
    .map((c) => c.caseId);
}

/** 1案件の採点。AI の並べ替え後の上位5件(runEstimate の結果)があれば、それも採点する */
export function scoreCase(args: { poc: PocCase; inquiry: Inquiry; ref: ReferenceData; aiTop5: string[] | null }): CaseScore {
  const { poc, inquiry, ref, aiTop5 } = args;
  const similar: SimilarScore[] = [];
  if (poc.similarCaseIds.length > 0) {
    similar.push(scoreSimilar("rule_extracted", ruleSearchTop5(inquiry.extraction.spec, ref, poc.ownCaseId), poc.similarCaseIds));
    similar.push(scoreSimilar("rule_truth", ruleSearchTop5(specFromTruth(inquiry.extraction.spec, poc.truth), ref, poc.ownCaseId), poc.similarCaseIds));
    if (aiTop5) similar.push(scoreSimilar("ai_rerank", aiTop5, poc.similarCaseIds));
  }
  return { fields: scoreFields(inquiry, poc.truth), questions: scoreQuestions(inquiry.extraction.questions, poc.expectedQuestions), similar };
}

// ---- 集計 ----

export type ScoredRow = { caseId: string; kind: string | null; score: CaseScore };

export type Aggregate = {
  cases: number;
  /** 項目ごとの正解率 */
  fields: { key: string; rate: Rate }[];
  overall: Rate;
  /** 確からしさ別の誤り。「高」なのに誤りが「自信のある誤り」 */
  confidence: { level: Confidence | "unknown"; n: number; wrong: number; errorRate: Rate }[];
  confidentErrors: { caseId: string; key: string; expected: string; actual: string }[];
  questions: {
    expectedTotal: number;
    found: number;
    recall: Rate;
    askedTotal: number;
    askedExpected: number;
    precision: Rate;
    unnecessaryTotal: number;
    unnecessaryPerCase: number | null;
    unnecessaryByOrigin: { ai: number; rule: number };
    unnecessaryFields: Record<string, number>;
    missed: { caseId: string; field: string }[];
    allFoundCases: Rate;
  };
  similar: { mode: SimilarMode; evaluated: number; hitAny: Rate; hitTop1: Rate; hitTop3: Rate; listedRecall: Rate }[];
  byKind: { kind: string; n: number; accuracy: Rate; confidentErrors: number }[];
};

export function aggregate(rows: ScoredRow[]): Aggregate {
  const fieldRows = rows.flatMap((r) => r.score.fields.map((f) => ({ ...f, caseId: r.caseId, kind: r.kind })));
  const keys = [...new Set(fieldRows.map((f) => f.key))];
  const levels: (Confidence | "unknown")[] = ["high", "medium", "low", "unknown"];
  const confidentErrors = fieldRows.filter((f) => !f.correct && f.confidence === "high").map((f) => ({ caseId: f.caseId, key: f.key, expected: f.expected, actual: f.actual }));

  const qs = rows.map((r) => ({ caseId: r.caseId, q: r.score.questions }));
  const expectedTotal = qs.reduce((s, x) => s + x.q.expected.length, 0);
  const found = qs.reduce((s, x) => s + x.q.found.length, 0);
  const askedTotal = qs.reduce((s, x) => s + x.q.asked.length, 0);
  const unnecessary = qs.flatMap((x) => x.q.unnecessary);
  const withExpected = qs.filter((x) => x.q.expected.length > 0);
  const unnecessaryFields: Record<string, number> = {};
  for (const u of unnecessary) unnecessaryFields[u.field] = (unnecessaryFields[u.field] ?? 0) + 1;

  const kinds = [...new Set(rows.map((r) => r.kind ?? "(未分類)"))];
  const modes = [...new Set(rows.flatMap((r) => r.score.similar.map((s) => s.mode)))] as SimilarMode[];
  return {
    cases: rows.length,
    fields: keys.map((key) => ({ key, rate: rateOf(fieldRows.filter((f) => f.key === key && f.correct).length, fieldRows.filter((f) => f.key === key).length) })),
    overall: rateOf(fieldRows.filter((f) => f.correct).length, fieldRows.length),
    confidence: levels.map((level) => {
      const fs = fieldRows.filter((f) => (f.confidence ?? "unknown") === level);
      const wrong = fs.filter((f) => !f.correct).length;
      return { level, n: fs.length, wrong, errorRate: rateOf(wrong, fs.length) };
    }),
    confidentErrors,
    questions: {
      expectedTotal,
      found,
      recall: rateOf(found, expectedTotal),
      askedTotal,
      askedExpected: qs.reduce((s, x) => s + x.q.asked.filter((f) => x.q.expected.includes(f)).length, 0),
      precision: rateOf(qs.reduce((s, x) => s + x.q.asked.filter((f) => x.q.expected.includes(f)).length, 0), askedTotal),
      unnecessaryTotal: unnecessary.length,
      unnecessaryPerCase: rows.length ? unnecessary.length / rows.length : null,
      unnecessaryByOrigin: { ai: unnecessary.filter((u) => u.origin === "ai").length, rule: unnecessary.filter((u) => u.origin === "rule").length },
      unnecessaryFields,
      missed: qs.flatMap((x) => x.q.missed.map((field) => ({ caseId: x.caseId, field }))),
      allFoundCases: rateOf(withExpected.filter((x) => x.q.missed.length === 0).length, withExpected.length),
    },
    similar: modes.map((mode) => {
      const ss = rows.flatMap((r) => r.score.similar.filter((s) => s.mode === mode));
      const listed = ss.reduce((s, x) => s + x.listed.length, 0);
      return {
        mode,
        evaluated: ss.length,
        hitAny: rateOf(ss.filter((s) => s.hitAny).length, ss.length),
        hitTop1: rateOf(ss.filter((s) => s.hitTop1).length, ss.length),
        hitTop3: rateOf(ss.filter((s) => s.hitTop3).length, ss.length),
        listedRecall: rateOf(ss.reduce((s, x) => s + x.listedInTop5, 0), listed),
      };
    }),
    byKind: kinds.map((kind) => {
      const rs = fieldRows.filter((f) => (f.kind ?? "(未分類)") === kind);
      return { kind, n: new Set(rs.map((f) => f.caseId)).size, accuracy: rateOf(rs.filter((f) => f.correct).length, rs.length), confidentErrors: rs.filter((f) => !f.correct && f.confidence === "high").length };
    }),
  };
}
