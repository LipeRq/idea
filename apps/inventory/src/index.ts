export { analyzeBuffer, analyzeFile, TOOL_NAME, TOOL_VERSION, type AnalyzeOptions } from "./analyze";
export { InventoryError, PasswordError, UnsupportedFileError } from "./errors";
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
