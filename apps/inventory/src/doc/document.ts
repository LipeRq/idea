// 仕様書の生成。AI が使えるときは解説文を Claude に書かせ、使えないとき・失敗したときは標準レポートにする。
import Anthropic from "@anthropic-ai/sdk";
import type { InventoryReport } from "../schema";
import { generateAiDocument, type GenerateOptions, type StructuredClient } from "./ai";
import type { AiDocument } from "./aiSchema";
import { renderMarkdown } from "./markdown";

export interface DocumentResult {
  markdown: string;
  ai: AiDocument | null;
  /** AI を使おうとして失敗した理由。AI を使わなかった・成功した場合は null */
  aiError: string | null;
}

export async function generateDocument(
  report: InventoryReport,
  client: StructuredClient | null,
  options: GenerateOptions = {},
): Promise<DocumentResult> {
  if (!client) return { markdown: renderMarkdown(report), ai: null, aiError: null };
  try {
    const ai = await generateAiDocument(report, client, options);
    return { markdown: renderMarkdown(report, { ai }), ai, aiError: null };
  } catch (e) {
    const aiError = describeAiError(e);
    return { markdown: renderMarkdown(report, { aiError }), ai: null, aiError };
  }
}

export function describeAiError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "APIキーが無効です";
  if (e instanceof Anthropic.RateLimitError) return "APIの利用上限に達しました。時間をおいて再実行してください";
  if (e instanceof Anthropic.APIConnectionError) return "APIに接続できませんでした";
  if (e instanceof Anthropic.APIError) return `APIエラー(${e.status ?? "不明"}): ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

/** AiDocument を JSON に保存できる形にする(UI などから再利用するため) */
export function aiDocumentToJson(doc: AiDocument) {
  return {
    modules: Object.fromEntries(
      [...doc.modules].map(([name, m]) => [name, { purpose: m.purpose, concerns: m.concerns, procedures: Object.fromEntries(m.procedures) }]),
    ),
    overall: doc.overall,
    notes: doc.notes,
  };
}
