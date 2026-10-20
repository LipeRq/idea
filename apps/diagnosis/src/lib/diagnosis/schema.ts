import { z } from "zod";
import "../zod-setup";
import {
  EMPLOYEE_BANDS,
  GOALS,
  INDUSTRIES,
  READINESS_IDS,
  TASK_IDS,
} from "./master";

export const DiagnosisInputSchema = z
  .object({
    companyName: z.string().trim().max(100).optional(),
    industry: z.enum(INDUSTRIES),
    employees: z.enum(EMPLOYEE_BANDS),
    hourlyCost: z.number().int().min(1_000).max(20_000),
    taskHours: z.partialRecord(z.enum(TASK_IDS), z.number().min(0).max(10_000)),
    readiness: z.record(z.enum(READINESS_IDS), z.number().int().min(0).max(3)),
    goals: z.array(z.enum(GOALS)).max(GOALS.length),
    challenges: z.string().trim().max(1_000).optional(),
  })
  .refine((v) => Object.values(v.taskHours).some((h) => (h ?? 0) > 0), {
    message: "少なくとも1つの業務に時間を入力してください",
    path: ["taskHours"],
  });

export type DiagnosisInput = z.infer<typeof DiagnosisInputSchema>;

// Claudeに返させるレポートの構造。数値は含めず、試算結果はサーバー側の計算値を使う。
export const AiReportSchema = z.object({
  summary: z.string().describe("経営者向けの総評。3〜5文。"),
  recommendations: z
    .array(
      z.object({
        taskId: z.enum(TASK_IDS),
        title: z.string().describe("施策名。20文字程度。"),
        approach: z.string().describe("この会社に合わせた具体的な進め方。2〜3文。"),
        tools: z.array(z.string()).describe("使うツールの種類や代表例。2〜3個。"),
        firstStep: z.string().describe("来週から始められる最初の一歩。1文。"),
        caution: z.string().describe("注意点やつまずきやすい点。1文。"),
      }),
    )
    .describe("優先施策。入力された順番どおりに、指定された業務すべてについて書く。"),
  roadmap: z
    .array(
      z.object({
        period: z.string().describe("「1ヶ月目」「2ヶ月目」「3ヶ月目」のいずれか"),
        goal: z.string().describe("その期間のゴール。1文。"),
        actions: z.array(z.string()).describe("具体的なアクション。2〜4個。"),
      }),
    )
    .describe("3ヶ月のロードマップ。3要素。"),
  readinessAdvice: z
    .array(z.string())
    .describe("AI導入の前に整えるべき社内の準備。2〜4個。"),
  discussionPoints: z
    .array(z.string())
    .describe("専門家と一緒に深掘りすると効果が大きい論点。2〜3個。"),
});

export type AiReport = z.infer<typeof AiReportSchema>;
