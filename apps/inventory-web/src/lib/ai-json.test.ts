import { describe, expect, it } from "vitest";
import { aiDocumentToJson } from "@engine/doc/document";
import { MOCK_OVERALL } from "@/lib/server/mock-client";
import { jsonToAiDocument, type AiDocumentJson } from "./ai-json";
import { AiDocumentJsonSchema } from "./ai-json-schema";

describe("AI の文章の JSON 表現", () => {
  it("エンジンの aiDocumentToJson と往復で一致し、画面のスキーマを通る", () => {
    const json: AiDocumentJson = {
      modules: { 売上集計: { purpose: "集計する", concerns: ["パスが固定"], procedures: { 集計実行: "月次の集計" } } },
      overall: MOCK_OVERALL as AiDocumentJson["overall"],
      notes: ["注記"],
    };
    const doc = jsonToAiDocument(json);
    expect(doc.modules.get("売上集計")?.procedures.get("集計実行")).toBe("月次の集計");
    expect(aiDocumentToJson(doc)).toEqual(json);
    expect(AiDocumentJsonSchema.safeParse(json).success).toBe(true);
    expect(AiDocumentJsonSchema.safeParse({ ...json, overall: { ...json.overall, risks: [{ title: 1 }] } }).success).toBe(false);
  });
});
