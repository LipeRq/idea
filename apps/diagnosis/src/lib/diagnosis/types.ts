import type { DiagnosisResult } from "./calculate";
import type { AiReport } from "./schema";

export type DiagnosisResponse = {
  result: DiagnosisResult;
  report: AiReport;
  /** false のときは標準レポート(AI分析なし) */
  aiGenerated: boolean;
};
