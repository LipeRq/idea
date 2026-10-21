// サーバーから受け取った AI の文章(NDJSON の done イベント)を、使う前に画面で検証するスキーマ。
// 画面アプリ自身の zod を使う(エンジンの zod のスキーマとは混ぜない)。
import "./zod-setup";
import { z } from "zod";
import type { AiDocumentJson } from "./ai-json";

const level = z.enum(["高", "中", "低"]);
const text = z.string().max(20_000);
const list = z.array(text).max(500);

export const AiDocumentJsonSchema = z.object({
  modules: z.record(
    z.string(),
    z.object({ purpose: text, concerns: list, procedures: z.record(z.string(), text) }),
  ),
  overall: z.object({
    overview: text,
    businessFlow: z.object({
      summary: text,
      steps: z
        .array(
          z.object({
            id: z.string().max(100),
            label: text,
            actor: z.enum(["利用者", "マクロ", "外部システム"]),
            next: z.array(z.string().max(100)).max(100),
          }),
        )
        .max(100),
    }),
    risks: z
      .array(z.object({ title: text, severity: level, detail: text, ruleIds: list, recommendation: text }))
      .max(100),
    migrations: z
      .array(
        z.object({
          target: text,
          fit: level,
          difficulty: level,
          reason: text,
          approach: text,
          concerns: text,
        }),
      )
      .max(50),
    recommendation: text,
    hearingItems: list,
  }),
  notes: list,
}) satisfies z.ZodType<AiDocumentJson>;
