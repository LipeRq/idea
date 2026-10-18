// Node.js 向けの入口(ファイルの読み込み・AI による文章生成を含む)。ブラウザでは ./browser を使う。
export { analyzeBuffer, TOOL_NAME, TOOL_VERSION, type AnalyzeOptions } from "./analyze";
export { analyzeFile } from "./analyzeFile";
export { CorruptFileError, InventoryError, LimitExceededError, PasswordError, UnsupportedFileError, type LimitKind } from "./errors";
export { DEFAULT_LIMITS, type AnalysisLimits } from "./limits";
export * from "./schema";
export { generateDocument, aiDocumentToJson, describeAiError, type DocumentResult } from "./doc/document";
export { renderMarkdown, DATA_NOTICE } from "./doc/markdown";
export {
  createClaudeClient,
  generateAiDocument,
  hasAnthropicCredentials,
  AiGenerationError,
  MODEL,
  type StructuredClient,
  type StructuredRequest,
} from "./doc/ai";
export type { AiDocument, AiOverall } from "./doc/aiSchema";
