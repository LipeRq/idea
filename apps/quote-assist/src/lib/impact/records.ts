import { usdToJpy } from "../ai/client";
import { todayJst } from "../dates";
import type { CaseRecord } from "../domain/impact";
import type { Inquiry } from "../domain/inquiry";
import type { QuoteInput } from "../quote/types";

// 集計の入力(CaseRecord)を作る。導入前は記録シートの1行から、導入後は見積アシストが残した1件の記録から。
// どちらも、保存されている値をそのまま写すか、決まった式で計算するだけ(AIは使わない)。

const EPS = 1e-9;
const same = (a: number, b: number) => Math.abs(a - b) < EPS;

// ---- 導入後(見積アシストの記録) ----

/** 見積原価:承認した見積の明細から、利益と端数処理を除いた合計 */
export function quotedCostOf(approved: NonNullable<Inquiry["approved"]>): number {
  return approved.lines.filter((l) => l.kind !== "profit" && l.kind !== "rounding").reduce((s, l) => s + l.amount, 0);
}

type Adoption = CaseRecord["adoption"];

/** 抽出項目:人が手で直した項目を「修正」とする */
export function extractionAdoption(inquiry: Inquiry): Adoption {
  return inquiry.extraction.fields.map((f) => ({
    item: `field:${f.key}`,
    evaluated: 1,
    modified: f.editedByHuman ? 1 : 0,
  }));
}

function processesChanged(before: QuoteInput["processes"][number], after: QuoteInput["processes"][number]): boolean {
  return !same(before.setupHours, after.setupHours) || !same(before.cycleHoursPerPiece, after.cycleHoursPerPiece) || after.chargeOverride !== null;
}

/** 修正した工程の修正幅:変える前の時間が0より大きい項目のうち、いちばん大きく変えたほうの割合 */
function changeRate(before: QuoteInput["processes"][number], after: QuoteInput["processes"][number]): number | null {
  const rates: number[] = [];
  if (before.cycleHoursPerPiece > 0) rates.push(Math.abs(after.cycleHoursPerPiece - before.cycleHoursPerPiece) / before.cycleHoursPerPiece);
  if (before.setupHours > 0) rates.push(Math.abs(after.setupHours - before.setupHours) / before.setupHours);
  return rates.length === 0 ? null : Math.max(...rates);
}

/** 見積の項目:AIの案(estimate.proposal)と、承認した見積の違い */
export function quoteAdoption(proposal: QuoteInput, final: QuoteInput): { adoption: Adoption; hourChangeRates: number[] } {
  const adoption: Adoption = [];
  const one = (item: string, modified: boolean) => adoption.push({ item, evaluated: 1, modified: modified ? 1 : 0 });

  one(
    "quote:material",
    proposal.material.materialId !== final.material.materialId ||
      proposal.material.pricePerKgOverride !== final.material.pricePerKgOverride,
  );
  one("quote:quantity", proposal.quantity !== final.quantity);

  // 工数:工程ごとに数える。人が追加した工程・外した工程も「修正」
  const rates: number[] = [];
  const ids = [...new Set([...proposal.processes, ...final.processes].map((p) => p.processId))];
  let evaluated = 0;
  let modified = 0;
  for (const id of ids) {
    const b = proposal.processes.find((p) => p.processId === id);
    const a = final.processes.find((p) => p.processId === id);
    evaluated++;
    if (!b || !a) {
      modified++;
      continue;
    }
    if (processesChanged(b, a)) {
      modified++;
      const rate = changeRate(b, a);
      if (rate !== null) rates.push(rate);
    }
  }
  if (evaluated > 0) adoption.push({ item: "quote:hours", evaluated, modified });

  const treat = (q: QuoteInput) =>
    q.treatments
      .map((t) => `${t.treatmentId}:${t.unitPriceOverride ?? ""}`)
      .sort()
      .join(",");
  one("quote:treatments", treat(proposal) !== treat(final));
  one("quote:profitRate", !same(proposal.profitRate, final.profitRate));
  one("quote:expedite", proposal.expedite !== final.expedite);
  return { adoption, hourChangeRates: rates };
}

/** 見積アシストで処理した1件を、集計の1件分の記録にする */
export function inquiryToRecord(inquiry: Inquiry): CaseRecord {
  const approved = inquiry.approved;
  const aiUsed = inquiry.metrics.some((m) => m.mode === "ai");
  const costUsd = inquiry.metrics.reduce((s, m) => s + (m.costUsd ?? 0), 0);
  const tokens = inquiry.metrics.reduce((s, m) => s + (m.usage ? m.usage.inputTokens + m.usage.outputTokens : 0), 0);
  const totalMs = inquiry.metrics.reduce((s, m) => s + m.durationMs, 0);

  let adoption: Adoption = [];
  let hourChangeRates: number[] = [];
  if (approved) {
    adoption = extractionAdoption(inquiry);
    if (inquiry.estimate) {
      const q = quoteAdoption(inquiry.estimate.proposal, approved.input);
      adoption = [...adoption, ...q.adoption];
      hourChangeRates = q.hourChangeRates;
    }
  }

  const outcome = inquiry.outcome ?? null;
  return {
    id: inquiry.id,
    receivedAt: todayJst(new Date(inquiry.createdAt)),
    answeredAt: approved ? todayJst(new Date(approved.at)) : null,
    operator: inquiry.operator?.trim() || null,
    workMinutes: approved ? Math.max(0, Math.round((Date.parse(approved.at) - Date.parse(inquiry.createdAt)) / 60_000)) : null,
    aiUsed,
    aiCostJpy: aiUsed ? usdToJpy(costUsd) : null,
    aiProcessingMs: aiUsed ? totalMs : null,
    aiTokens: aiUsed ? tokens : null,
    adoption,
    hourChangeRates,
    result: outcome?.result ?? null,
    orderAmount: outcome?.result === "won" && approved ? approved.total : null,
    quotedCost: approved ? quotedCostOf(approved) : null,
    actualCost: outcome?.actualCost ?? null,
    reworkCount: outcome?.reworkCount ?? null,
  };
}
