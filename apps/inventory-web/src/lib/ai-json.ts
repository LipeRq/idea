// AI が書いた文章(AiDocument)の JSON 表現と、その逆変換。
// サーバーはエンジンの aiDocumentToJson で JSON にして返し、画面はそれを Worker に渡して
// renderMarkdown(report, { ai }) で AI 版の仕様書にする(AiDocument は Map を含むため、そのままでは送れない)。
import type { AiDocument, AiOverall } from "@engine/doc/aiSchema";

export interface AiModuleJson {
  purpose: string;
  concerns: string[];
  procedures: Record<string, string>;
}

/** エンジンの aiDocumentToJson の戻り値と同じ形 */
export interface AiDocumentJson {
  modules: Record<string, AiModuleJson>;
  overall: AiOverall;
  notes: string[];
}

export function jsonToAiDocument(json: AiDocumentJson): AiDocument {
  return {
    modules: new Map(
      Object.entries(json.modules).map(([name, m]) => [
        name,
        { purpose: m.purpose, concerns: [...m.concerns], procedures: new Map(Object.entries(m.procedures)) },
      ]),
    ),
    overall: json.overall,
    notes: [...json.notes],
  };
}
