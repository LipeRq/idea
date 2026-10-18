import { findScenario } from "../demo/scenarios";
import type { ExtractionOutput } from "./schema";

// デモモード(APIキーなし)の抽出。合成データの図面(public/samples)には、
// AIが返すのと同じ形の固定結果を返す。それ以外の図面はすべて「読み取れない」として扱う。

const unknown = { value: null, raw: null, confidence: "low" as const, sources: [], note: null };

export function demoExtraction(args: {
  fileNames: string[];
  email: { subject: string; body: string };
  today: string;
}): { output: ExtractionOutput; scenarioId: string | null } {
  const scenario = findScenario(args.fileNames, `${args.email.subject}\n${args.email.body}`);
  if (scenario) {
    return {
      output: scenario.buildExtraction({ emailBody: args.email.body, today: args.today }),
      scenarioId: scenario.id,
    };
  }
  return {
    scenarioId: null,
    output: emptyExtraction(
      "デモモードのため、サンプル以外の図面は読み取っていません。各項目を手入力するか、APIキーを設定してください。",
    ),
  };
}

/** すべての項目が「読み取れない」抽出結果(AIの失敗時やサンプル以外の図面) */
export function emptyExtraction(summary: string): ExtractionOutput {
  return {
    summary,
    customerName: unknown,
    contactName: unknown,
    partName: unknown,
    drawingNumber: unknown,
    revision: unknown,
    material: unknown,
    quantity: unknown,
    dimensions: unknown,
    tolerance: unknown,
    surfaceTreatment: unknown,
    heatTreatment: unknown,
    dueDate: unknown,
    inspection: unknown,
    processType: unknown,
    features: [],
    notes: [],
    questions: [],
  };
}
