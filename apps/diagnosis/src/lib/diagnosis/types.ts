import type { DiagnosisResult } from "./calculate";
import type { AiReport } from "./schema";

/** 標準レポートにした理由(画面で案内するものだけ) */
export type FallbackReason = "daily_limit";

export type DiagnosisResponse = {
  result: DiagnosisResult;
  report: AiReport;
  /** false のときは標準レポート(AI分析なし) */
  aiGenerated: boolean;
  /** AIの文章に付けた署名。PDFを作るときに送り返す(標準レポートのときはなし) */
  reportToken?: string;
  /** "daily_limit":AIの1日の呼び出し上限に達したため、標準レポートにした */
  fallbackReason?: FallbackReason;
};
