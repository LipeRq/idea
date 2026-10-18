import type { Question, Spec } from "./domain/inquiry";
import type { GroundTruth } from "./demo/scenarios";

// 抽出精度の評価(use-cases.md 5.5 の9)。正解ラベルと、正規化後の値を項目ごとに比べる。

export type FieldResult = { key: string; expected: string; actual: string; correct: boolean };

const show = (v: unknown) => (v === null || v === undefined ? "(なし)" : typeof v === "object" ? JSON.stringify(v) : String(v));

export function evaluateExtraction(spec: Spec, questions: Question[], truth: GroundTruth) {
  const pairs: [string, unknown, unknown][] = [
    ["partName", truth.partName, spec.partName],
    ["drawingNumber", truth.drawingNumber, spec.drawingNumber],
    ["revision", truth.revision, spec.revision],
    ["material", truth.materialId, spec.materialId],
    ["quantity", truth.quantity, spec.quantity],
    ["dimensions", truth.dimensions, spec.dimensions],
    ["tolerance", truth.toleranceMm, spec.toleranceMm],
    ["surfaceTreatment", truth.surfaceTreatmentId, spec.surfaceTreatmentId],
    ["heatTreatment", truth.heatTreatmentId, spec.heatTreatmentId],
  ];
  const fields: FieldResult[] = pairs.map(([key, expected, actual]) => ({
    key,
    expected: show(expected),
    actual: show(actual),
    correct: JSON.stringify(expected) === JSON.stringify(actual),
  }));
  const asked = new Set(questions.map((q) => q.field));
  const found = truth.expectedQuestions.filter((f) => asked.has(f as Question["field"]));
  return {
    fields,
    accuracy: fields.filter((f) => f.correct).length / fields.length,
    // 確認すべき項目のうち、確認事項に挙がった割合
    questionRecall: truth.expectedQuestions.length === 0 ? 1 : found.length / truth.expectedQuestions.length,
    missedQuestions: truth.expectedQuestions.filter((f) => !asked.has(f as Question["field"])),
  };
}
