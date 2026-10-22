import { addDays, businessDaysBetween } from "../dates";
import { ADOPTION_ITEM_KEYS, type CaseRecord } from "../domain/impact";

// 効果測定のKPIを、1件ごとの記録(CaseRecord)から計算する純粋関数。
// 導入前(記録シート)も導入後(見積アシストのログ)も同じ関数で計算する。AIは数字の計算に使わない。
// 値の定義は definitions.ts に文章でも持つ(画面・報告書・書き出しに同じ文言を出す)。

/** 集計に入った件数がこれ未満の値は「参考値」と表示する */
export const MIN_RELIABLE_N = 10;

/**
 * n:割る数(中央値・平均なら値のある件数)。missing:対象なのに必要な値がなくて除いた件数。
 * value が null のときは「対象なし」(分母が0)で、0 とは区別する。
 */
export type Stat = { value: number | null; n: number; missing: number };

export const isReference = (s: Stat): boolean => s.value !== null && s.n < MIN_RELIABLE_N;

const EPS = 1e-9;

export function median(values: readonly number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function mean(values: readonly number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x));
  return v.length === 0 ? null : v.reduce((s, x) => s + x, 0) / v.length;
}

/** 割合。分母が0のときは null(0%ではなく「対象なし」) */
export function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

const isNum = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** 受付日から回答日までの営業日数。回答日がない・受付日より前のときは null(欠損) */
export function leadTimeDays(r: Pick<CaseRecord, "receivedAt" | "answeredAt">): number | null {
  if (!r.answeredAt) return null;
  const days = businessDaysBetween(r.receivedAt, r.answeredAt);
  return days < 0 ? null : days;
}

/** 部分一致(どちらかがもう一方を含む)で、見積担当者の名簿にいる人か */
export function isEstimator(operator: string, estimators: readonly string[]): boolean {
  const name = operator.trim();
  if (name.length === 0) return false;
  return estimators.some((e) => {
    const x = e.trim();
    return x.length > 0 && (x.includes(name) || name.includes(x));
  });
}

export type AdoptionRow = {
  item: string;
  evaluated: number;
  modified: number;
  /** 人が変えずに採用した割合 */
  adoptedRate: number | null;
  /** 人が修正した割合 */
  modifiedRate: number | null;
};

export type KpiSet = {
  /** 記録の件数(欠損を含む) */
  cases: number;
  /** 見積回答リードタイム(営業日)の中央値 */
  leadTimeDays: Stat;
  /** 1件あたりの作業時間(分)の平均 */
  workMinutes: Stat;
  workMinutesMedian: number | null;
  /** 見積担当者以外が作成した割合(0〜1) */
  nonEstimatorShare: Stat;
  /** 受注率(受注÷(受注+失注)) */
  winRate: Stat;
  /** 赤字案件の割合(実績原価が受注額を超えた受注件数÷実績の入った受注件数) */
  deficitShare: Stat;
  /** 見積原価と実績原価の差率(実績−見積)÷見積 の中央値 */
  costGapRate: Stat;
  /** 受注1件あたりの手戻り件数 */
  reworkPerWon: Stat;
  aiCostJpy: Stat;
  aiProcessingMs: Stat;
  aiTokens: Stat;
  /** AI案の採用率(全項目の合計)。value は採用率 */
  adoptionOverall: Stat;
  adoption: AdoptionRow[];
  /** 修正した工程の1個あたり時間の修正幅の中央値 */
  hourChange: Stat;
};

function stat(values: readonly number[], population: number, fn: (v: readonly number[]) => number | null): Stat {
  return { value: fn(values), n: values.length, missing: population - values.length };
}

export function computeKpis(records: readonly CaseRecord[], estimators: readonly string[]): KpiSet {
  const all = records;

  // 見積回答リードタイム
  const lead = all.map(leadTimeDays).filter(isNum);

  // 作業時間
  const work = all.map((r) => r.workMinutes).filter(isNum);

  // 見積担当者以外が作成した割合(作成者が分かるものだけ)
  const known = all.filter((r) => r.operator !== null && r.operator.trim().length > 0);
  const nonEstimator = known.filter((r) => !isEstimator(r.operator!, estimators)).length;

  // 受注率:回答済みのうち、受注か失注かが分かるもの。回答済みで結果が未定のものは欠損
  const answered = all.filter((r) => r.answeredAt !== null);
  const decided = answered.filter((r) => r.result !== null);
  const won = all.filter((r) => r.result === "won");

  // 見積と実績の差:実績原価が入った受注案件
  const withActual = won.filter((r) => isNum(r.actualCost) && isNum(r.orderAmount));
  const deficit = withActual.filter((r) => r.actualCost! > r.orderAmount! + EPS).length;
  const gaps = won
    .filter((r) => isNum(r.actualCost) && isNum(r.quotedCost) && r.quotedCost > 0)
    .map((r) => (r.actualCost! - r.quotedCost!) / r.quotedCost!);

  // 手戻り:手戻り件数が記録された受注案件の、1件あたり件数
  const rework = won.map((r) => r.reworkCount).filter(isNum);

  // AIの費用・処理量(AIを使った記録だけ)
  const ai = all.filter((r) => r.aiUsed);

  // 項目別の採用率・修正率
  const byItem = new Map<string, { evaluated: number; modified: number }>();
  for (const r of all) {
    for (const a of r.adoption) {
      const cur = byItem.get(a.item) ?? { evaluated: 0, modified: 0 };
      cur.evaluated += a.evaluated;
      cur.modified += Math.min(a.modified, a.evaluated);
      byItem.set(a.item, cur);
    }
  }
  const adoption: AdoptionRow[] = ADOPTION_ITEM_KEYS.filter((k) => byItem.has(k)).map((item) => {
    const { evaluated, modified } = byItem.get(item)!;
    return {
      item,
      evaluated,
      modified,
      adoptedRate: ratio(evaluated - modified, evaluated),
      modifiedRate: ratio(modified, evaluated),
    };
  });
  const totalEvaluated = adoption.reduce((s, a) => s + a.evaluated, 0);
  const totalModified = adoption.reduce((s, a) => s + a.modified, 0);
  const adoptedCases = all.filter((r) => r.adoption.some((a) => a.evaluated > 0)).length;

  return {
    cases: all.length,
    leadTimeDays: stat(lead, all.length, median),
    workMinutes: stat(work, all.length, mean),
    workMinutesMedian: median(work),
    nonEstimatorShare: {
      value: ratio(nonEstimator, known.length),
      n: known.length,
      missing: all.length - known.length,
    },
    winRate: {
      value: ratio(decided.filter((r) => r.result === "won").length, decided.length),
      n: decided.length,
      missing: answered.length - decided.length,
    },
    deficitShare: {
      value: ratio(deficit, withActual.length),
      n: withActual.length,
      missing: won.length - withActual.length,
    },
    costGapRate: stat(gaps, won.length, median),
    reworkPerWon: stat(rework, won.length, (v) => (v.length === 0 ? null : v.reduce((s, x) => s + x, 0) / v.length)),
    aiCostJpy: stat(ai.map((r) => r.aiCostJpy).filter(isNum), ai.length, mean),
    aiProcessingMs: stat(ai.map((r) => r.aiProcessingMs).filter(isNum), ai.length, mean),
    aiTokens: stat(ai.map((r) => r.aiTokens).filter(isNum), ai.length, mean),
    adoptionOverall: {
      value: ratio(totalEvaluated - totalModified, totalEvaluated),
      // 件数は「項目を評価した記録の数」(分母の項目数ではない)
      n: adoptedCases,
      missing: all.length - adoptedCases,
    },
    adoption,
    hourChange: stat(
      all.flatMap((r) => r.hourChangeRates).filter(isNum),
      all.flatMap((r) => r.hourChangeRates).length,
      median,
    ),
  };
}

// ---- 期間ごとの集計(週・月) ----

export type Granularity = "week" | "month";

/** その日を含む週の月曜日(YYYY-MM-DD) */
export function weekStart(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0=日
  return addDays(date, -((weekday + 6) % 7));
}

export function periodKey(date: string, g: Granularity): string {
  return g === "week" ? weekStart(date) : date.slice(0, 7);
}

function nextPeriod(key: string, g: Granularity): string {
  if (g === "week") return addDays(key, 7);
  const [y, m] = key.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** 画面の目盛り用の短い名前(週は月曜日の日付、月は「10月」) */
export function periodLabel(key: string, g: Granularity): string {
  if (g === "month") return `${Number(key.slice(5, 7))}月`;
  return `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;
}

/** ツールチップ・表用の名前 */
export function periodLongLabel(key: string, g: Granularity): string {
  if (g === "month") return `${key.slice(0, 4)}年${Number(key.slice(5, 7))}月`;
  const end = addDays(key, 6);
  return `${Number(key.slice(5, 7))}月${Number(key.slice(8, 10))}日の週(〜${Number(end.slice(5, 7))}/${Number(end.slice(8, 10))})`;
}

export type PeriodPoint = { key: string; label: string; longLabel: string; kpis: KpiSet };

/** 表示する期間の最大数(古い期間を捨てる)。日付の誤入力で何千もの期間が並ばないようにする */
export const MAX_PERIODS = 60;

/**
 * 受付日で期間に分けて集計する。記録のない期間も含めて(件数0で)連続して並べる。
 * 直近の期間は、回答・結果が出ていない記録が多く、件数が少なく出る。
 */
export function periodSeries(records: readonly CaseRecord[], g: Granularity, estimators: readonly string[]): PeriodPoint[] {
  if (records.length === 0) return [];
  const buckets = new Map<string, CaseRecord[]>();
  for (const r of records) {
    const key = periodKey(r.receivedAt, g);
    const list = buckets.get(key);
    if (list) list.push(r);
    else buckets.set(key, [r]);
  }
  const keys = [...buckets.keys()].sort();
  const points: PeriodPoint[] = [];
  for (let key = keys[0]; key <= keys[keys.length - 1]; key = nextPeriod(key, g)) {
    points.push({
      key,
      label: periodLabel(key, g),
      longLabel: periodLongLabel(key, g),
      kpis: computeKpis(buckets.get(key) ?? [], estimators),
    });
    if (points.length > 5000) break;
  }
  return points.slice(-MAX_PERIODS);
}

// ---- 導入前との比較 ----

export type Direction = "lower" | "higher" | "none";
export type Verdict = "better" | "worse" | "same" | "unknown";

export type Comparison = {
  /** 導入後 − 導入前 */
  diff: number | null;
  /** 差 ÷ |導入前|。導入前が0なら null */
  rate: number | null;
  verdict: Verdict;
  /** どちらかが参考値(件数が少ない) */
  reference: boolean;
};

export function compareStat(baseline: Stat, post: Stat, direction: Direction): Comparison {
  const reference = isReference(baseline) || isReference(post);
  if (baseline.value === null || post.value === null) return { diff: null, rate: null, verdict: "unknown", reference };
  const diff = post.value - baseline.value;
  const rate = Math.abs(baseline.value) < EPS ? null : diff / Math.abs(baseline.value);
  let verdict: Verdict;
  if (direction === "none") verdict = "unknown";
  else if (Math.abs(diff) < EPS) verdict = "same";
  else verdict = (direction === "lower") === diff < 0 ? "better" : "worse";
  return { diff, rate, verdict, reference };
}
