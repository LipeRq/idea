import type { AiDocumentJson } from "@/lib/ai-json";
import type { RenderedDocument } from "@/worker/protocol";

/** AI 版の結果(サーバーから受け取った文章と、それを Worker で仕様書にしたもの) */
export interface AiResult {
  json: AiDocumentJson;
  document: RenderedDocument;
  businessFlow: string | null;
  mock: boolean;
}
