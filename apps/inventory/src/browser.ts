// ブラウザ向けの入口。ファイルをサーバーに送らずに、ブラウザ内で解析して標準レポート(Markdown)を作るためのもの。
// Node.js の API(fs・crypto・Buffer)と Anthropic SDK(AI による文章生成)は含まない。
// バンドル方法は scripts/build-browser.mjs を参照(mdb-reader の暗号処理をブラウザ用に差し替えている)。
export { analyzeBuffer, TOOL_NAME, TOOL_VERSION, type AnalyzeOptions } from "./analyze";
export { CorruptFileError, InventoryError, LimitExceededError, PasswordError, UnsupportedFileError, type LimitKind } from "./errors";
export { DEFAULT_LIMITS, type AnalysisLimits } from "./limits";
export * from "./schema";
export { renderMarkdown, DATA_NOTICE } from "./doc/markdown";
