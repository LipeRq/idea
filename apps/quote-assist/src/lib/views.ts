import { notFound } from "next/navigation";
import { connection } from "next/server";
import { usdToJpy } from "./ai/client";
import type { Inquiry } from "./domain/inquiry";
import { getDeps } from "./deps";

// 画面(Server Component)用の読み込みと集計

export async function loadInquiryView(id: string) {
  // 保存データは要求ごとに読む(事前レンダリングに含めない)
  await connection();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const deps = getDeps();
  const inquiry = await deps.storage.inquiries.get(id);
  if (!inquiry) notFound();
  const ref = await deps.reference();
  return { inquiry, ref, deps };
}

export type MetricsSummary = {
  totalMs: number;
  aiMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  costUsd: number;
  costJpy: number;
  usedAi: boolean;
};

export function summarizeMetrics(inquiry: Inquiry): MetricsSummary {
  const s = inquiry.metrics.reduce(
    (acc, m) => ({
      totalMs: acc.totalMs + m.durationMs,
      aiMs: acc.aiMs + (m.mode === "ai" ? m.durationMs : 0),
      inputTokens: acc.inputTokens + (m.usage?.inputTokens ?? 0),
      outputTokens: acc.outputTokens + (m.usage?.outputTokens ?? 0),
      cacheTokens: acc.cacheTokens + (m.usage ? m.usage.cacheCreationInputTokens + m.usage.cacheReadInputTokens : 0),
      costUsd: acc.costUsd + (m.costUsd ?? 0),
      usedAi: acc.usedAi || m.mode === "ai",
    }),
    { totalMs: 0, aiMs: 0, inputTokens: 0, outputTokens: 0, cacheTokens: 0, costUsd: 0, usedAi: false },
  );
  return { ...s, costJpy: usdToJpy(s.costUsd) };
}

/** AI案(類似実績からの案を含む)を人が変えずに採用した工程の割合。修正がなければ1 */
export function adoptionRate(inquiry: Inquiry): number | null {
  const processes = inquiry.quote?.input.processes;
  if (!processes || processes.length === 0) return null;
  return processes.filter((p) => p.source.kind !== "human").length / processes.length;
}

/** 登録から承認までの経過時間(分) */
export function minutesToApprove(inquiry: Inquiry): number | null {
  if (!inquiry.approved) return null;
  return Math.max(0, Math.round((Date.parse(inquiry.approved.at) - Date.parse(inquiry.createdAt)) / 60_000));
}
