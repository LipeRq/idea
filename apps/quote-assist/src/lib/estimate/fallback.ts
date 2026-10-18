import type { PastCase, RateTable } from "../domain/reference";
import { volumeCm3 as volume } from "../quote/calculate";
import type { SimilarCase, Spec } from "../domain/inquiry";
import type { QuoteProcessInput } from "../quote/types";
import { formatNumber } from "../format";

// AIを使わない工数案:類似案件の「実績」工数を類似度で加重平均し、大きさの差を補正する。
// デモモードと、AIの呼び出しに失敗したときに使う。AIの案に根拠がない工程の置き換えにも使う。

export type ProcessProposal = { input: QuoteProcessInput; rationale: string };

// 大きさで加工時間が変わる工程(バリ取り・検査は大きさの影響が小さいとみなす)
const SIZE_DEPENDENT = new Set(["mc", "lathe", "grinding", "cyl_grinding", "wire", "laser"]);


const roundCycle = (h: number) => Math.max(0.05, Math.round(h / 0.05) * 0.05);
const roundSetup = (h: number) => Math.round(h / 0.25) * 0.25;
const fix = (h: number) => Math.round(h * 100) / 100;

export function fallbackProposals(
  spec: Spec,
  similar: SimilarCase[],
  cases: PastCase[],
  rates: RateTable,
): ProcessProposal[] {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const ranked = similar
    .map((s) => ({ s, c: byId.get(s.caseId) }))
    .filter((x): x is { s: SimilarCase; c: PastCase } => x.c !== undefined);
  const sameType = ranked.filter((x) => spec.processType === null || x.c.processType === spec.processType);
  const basis = (sameType.length > 0 ? sameType : ranked).slice(0, 3);
  if (basis.length === 0) return [];

  const totalWeight = basis.reduce((sum, x) => sum + x.s.score, 0);
  // 同じ図番の旧版がいちばん似ていれば、その工程は必ず含める(研削など、図面の要求で決まる工程があるため)
  const sameDrawing = basis.find((x) => x.s.breakdown.some((b) => b.factor === "drawing" && b.points > 0));
  const processIds = rates.processes
    .map((p) => p.id)
    .filter((id) => {
      if (sameDrawing?.c.estimatedProcesses.some((p) => p.processId === id)) return true;
      const w = basis
        .filter((x) => x.c.estimatedProcesses.some((p) => p.processId === id))
        .reduce((sum, x) => sum + x.s.score, 0);
      return w / totalWeight >= 0.5;
    });
  if (!processIds.includes("inspection")) processIds.push("inspection");

  const queryVolume = spec.dimensions ? volume(spec.dimensions) : null;
  return processIds.map((processId) => {
    const used = basis
      .map((x) => {
        const hours = (x.c.actualProcesses ?? x.c.estimatedProcesses).find((p) => p.processId === processId);
        if (!hours) return null;
        const ratio = queryVolume && SIZE_DEPENDENT.has(processId) ? queryVolume / volume(x.c.dimensions) : 1;
        const sizeFactor = Math.min(1.4, Math.max(0.7, Math.cbrt(ratio)));
        return { x, hours, sizeFactor, actual: x.c.actualProcesses !== null };
      })
      .filter((u) => u !== null);

    if (used.length === 0) {
      return {
        input: {
          processId,
          setupHours: 0.25,
          cycleHoursPerPiece: 0.05,
          chargeOverride: null,
          source: { kind: "fallback", caseIds: [], note: "類似案件に実績がないため標準値" },
        },
        rationale: "類似案件にこの工程の実績がないため、標準値(段取り0.25時間・1個0.05時間)を置いています",
      };
    }
    const w = used.reduce((sum, u) => sum + u.x.s.score, 0);
    const cycle = used.reduce((sum, u) => sum + u.x.s.score * u.hours.cycleHoursPerPiece * u.sizeFactor, 0) / w;
    const setup = used.reduce((sum, u) => sum + u.x.s.score * u.hours.setupHours, 0) / w;
    const name = rates.processes.find((p) => p.id === processId)?.name ?? processId;
    const parts = used.map(
      (u) =>
        `${u.x.c.id}(${u.actual ? "実績" : "見積"}${formatNumber(u.hours.cycleHoursPerPiece, 2)}h` +
        (u.sizeFactor !== 1 ? `×大きさ補正${formatNumber(u.sizeFactor, 2)}` : "") +
        ")",
    );
    return {
      input: {
        processId,
        setupHours: fix(roundSetup(setup)),
        cycleHoursPerPiece: fix(roundCycle(cycle)),
        chargeOverride: null,
        source: { kind: "fallback", caseIds: used.map((u) => u.x.c.id), note: null },
      },
      rationale: `${name}:類似案件 ${parts.join("、")} を類似度で加重平均`,
    };
  });
}
