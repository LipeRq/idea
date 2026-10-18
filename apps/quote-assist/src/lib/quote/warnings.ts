import type { Company, Dimensions, PastCase, RateTable } from "../domain/reference";
import type { SimilarCase, Spec } from "../domain/inquiry";
import { businessDaysBetween, daysBetween, formatJpDate } from "../dates";
import { formatYen } from "../format";
import { needsExpedite } from "./build";
import type { QuoteInput, QuoteResult } from "./types";

// 見積のリスク確認(use-cases.md 5.2 の手順7)。すべてルールで判定する。

export type QuoteWarning = { level: "warning" | "info"; message: string };

const STRONG_MATCH = 60;

function fitsEquipment(d: Dimensions, e: Company["equipment"][number]): boolean {
  if (e.maxDiameterMm !== null) {
    if (d.shape !== "round") return true; // 旋盤で角物は加工しない前提で、判定しない
    return (d.diameterMm ?? 0) <= e.maxDiameterMm && d.lengthMm <= e.maxLengthMm;
  }
  const part = (d.shape === "round" ? [d.lengthMm, d.diameterMm ?? 0, d.diameterMm ?? 0] : [d.lengthMm, d.widthMm ?? 0, d.heightMm ?? 0]).sort((a, b) => b - a);
  const env = [e.maxLengthMm, e.maxWidthMm ?? Infinity, e.maxHeightMm ?? Infinity].sort((a, b) => b - a);
  return part.every((v, i) => v <= env[i]);
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function quoteWarnings(args: {
  spec: Spec;
  input: QuoteInput;
  result: QuoteResult;
  similar: SimilarCase[];
  cases: PastCase[];
  rates: RateTable;
  company: Company;
  today: string;
  assumptions: string[];
}): QuoteWarning[] {
  const { spec, input, result, similar, rates, company, today } = args;
  const out: QuoteWarning[] = args.assumptions.map((message) => ({ level: "warning", message }));

  const age = daysBetween(rates.updatedAt, today);
  if (age > rates.rules.staleAfterDays) {
    out.push({ level: "warning", message: `単価表(${rates.name})の更新から${age}日たっています。材料単価・チャージを確認してください` });
  }

  if (spec.dueDate) {
    const days = businessDaysBetween(today, spec.dueDate);
    const lead = `希望納期(${formatJpDate(spec.dueDate)})まで営業日で${days}日、標準リードタイムは${result.standardLeadDays}営業日`;
    const shouldExpedite = needsExpedite(input, spec.dueDate, today, rates);
    if (input.expedite) out.push({ level: "info", message: `${lead}のため、特急料金を計上しています` });
    else if (shouldExpedite) out.push({ level: "warning", message: `${lead}ですが、特急料金を外しています` });
    else out.push({ level: "info", message: lead });
  }

  const strong = similar.filter((s) => s.score >= STRONG_MATCH);
  const byId = new Map(args.cases.map((c) => [c.id, c]));
  const peers = strong
    .map((s) => byId.get(s.caseId))
    .filter((c): c is PastCase => c !== undefined && c.materialId === input.material.materialId);
  if (peers.length > 0) {
    const m = median(peers.map((c) => c.unitPrice));
    const diff = (result.unitPrice - m) / m;
    if (Math.abs(diff) > rates.rules.priceDeviationWarnRate) {
      const qty = peers.map((c) => `${c.quantity}個`).join("・");
      out.push({
        level: "warning",
        message: `単価${formatYen(result.unitPrice)}が、よく似た過去案件の単価(中央値${formatYen(m)}、数量${qty})から${diff > 0 ? "+" : ""}${Math.round(diff * 100)}%離れています`,
      });
    }
  }
  for (const s of strong) {
    for (const w of s.warnings) {
      if (w.includes("赤字") || w.startsWith("不具合")) out.push({ level: "warning", message: `類似案件 ${s.caseId}:${w}` });
    }
  }

  for (const p of input.processes) {
    const equipment = company.equipment.filter((e) => e.processId === p.processId);
    if (equipment.length > 0 && !equipment.some((e) => fitsEquipment(input.material.dimensions, e))) {
      const name = rates.processes.find((r) => r.id === p.processId)?.name ?? p.processId;
      out.push({ level: "warning", message: `${name}の設備の加工範囲を超える可能性があります(外注または分割を検討)` });
    }
    if (p.source.kind !== "human" && p.source.caseIds.length === 0) {
      const name = rates.processes.find((r) => r.id === p.processId)?.name ?? p.processId;
      out.push({ level: "warning", message: `${name}の工数は根拠となる過去案件がない標準値です。確認してください` });
    }
  }

  if (spec.toleranceMm !== null && spec.toleranceMm <= 0.005) {
    const grinding = input.processes.some((p) => p.processId === "grinding" || p.processId === "cyl_grinding");
    if (!grinding) out.push({ level: "warning", message: `±${spec.toleranceMm}の公差があります。研削工程の要否を確認してください` });
  }
  return out;
}
