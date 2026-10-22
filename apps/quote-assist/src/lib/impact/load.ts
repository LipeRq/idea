import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { todayJst } from "../dates";
import {
  BaselineFileSchema,
  PilotFileSchema,
  type Baseline,
  type BaselineInput,
  type CaseRecord,
} from "../domain/impact";
import type { Deps } from "../deps";
import { referenceDir } from "../reference/load";
import type { Granularity } from "./kpi";
import { baselineRowToRecord, countEstimatedRows } from "./baseline-records";
import { inquiryToRecord } from "./records";
import { buildImpactReport, type ImpactReport } from "./report";

// 効果測定の画面・書き出しが使う、保存データの読み込み(サーバー側)。

export type DataSource = "demo" | "app";
export type BaselineOrigin = "saved" | "demo" | "none";

const BASELINE_DEMO_FILE = "impact-baseline.json";
const PILOT_DEMO_FILE = "impact-pilot.json";

async function readJsonFile(file: string): Promise<{ data: unknown; mtime: Date } | null> {
  try {
    const [text, s] = await Promise.all([
      readFile(/*turbopackIgnore: true*/ file, "utf8"),
      stat(/*turbopackIgnore: true*/ file),
    ]);
    return { data: JSON.parse(text), mtime: s.mtime };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** デモ用の架空のベースライン(参照データのフォルダにあるときだけ) */
async function loadDemoBaseline(): Promise<Baseline | null> {
  const file = await readJsonFile(path.join(referenceDir(), BASELINE_DEMO_FILE));
  if (!file) return null;
  const parsed = BaselineFileSchema.parse(file.data);
  return { ...parsed, updatedAt: file.mtime.toISOString() };
}

/** デモ用の架空の導入後記録(参照データのフォルダにあるときだけ) */
export async function loadDemoPilot(): Promise<{ note: string; records: CaseRecord[] } | null> {
  const file = await readJsonFile(path.join(referenceDir(), PILOT_DEMO_FILE));
  return file ? PilotFileSchema.parse(file.data) : null;
}

/** 保存したベースライン。なければデモ用の架空データ。それもなければ none */
export async function loadBaseline(deps: Deps): Promise<{ baseline: Baseline | null; source: BaselineOrigin }> {
  const saved = await deps.storage.impact.getBaseline();
  if (saved) return { baseline: saved, source: "saved" };
  const demo = await loadDemoBaseline();
  return demo ? { baseline: demo, source: "demo" } : { baseline: null, source: "none" };
}

export async function saveBaseline(deps: Deps, input: BaselineInput): Promise<Baseline> {
  const baseline: Baseline = { ...input, updatedAt: deps.now().toISOString() };
  await deps.storage.impact.saveBaseline(baseline);
  return baseline;
}

export type ImpactView = {
  report: ImpactReport;
  source: DataSource;
  /** デモ用の架空の導入後記録があるか(あるときだけ切り替えを出す) */
  demoAvailable: boolean;
  baselineOrigin: BaselineOrigin;
  baselineNote: string;
  postNote: string;
  baselineRows: number;
};

export function parseSource(value: string | undefined): DataSource | null {
  return value === "demo" || value === "app" ? value : null;
}

export function parseGranularity(value: string | undefined): Granularity {
  return value === "month" ? "month" : "week";
}

/**
 * ダッシュボード・報告書・書き出しに共通の集計。
 * 導入後は、デモ用の架空の記録(あれば初期表示)か、このアプリで処理した実際の記録のどちらか。
 */
export async function loadImpactView(
  deps: Deps,
  options: { source: DataSource | null; granularity: Granularity },
): Promise<ImpactView> {
  const [ref, { baseline, source: baselineOrigin }, pilot] = await Promise.all([
    deps.reference(),
    loadBaseline(deps),
    loadDemoPilot(),
  ]);
  const source: DataSource = pilot ? (options.source ?? "demo") : "app";

  const baselineRecords = (baseline?.rows ?? []).map(baselineRowToRecord);
  let postRecords: CaseRecord[];
  let postLabel: string;
  let postNote: string;
  if (source === "demo" && pilot) {
    postRecords = pilot.records;
    postLabel = "デモ用の架空の記録(しらかば精工)";
    postNote = pilot.note;
  } else {
    postRecords = (await deps.storage.inquiries.list()).map(inquiryToRecord);
    postLabel = "このアプリで処理した実際の記録";
    postNote = "このアプリに保存されている引き合いの記録から計算しています。";
  }

  const baselineLabel =
    baselineOrigin === "saved" ? "御社が入力したベースライン" : baselineOrigin === "demo" ? "デモ用の架空のベースライン" : "未入力";

  const report = buildImpactReport({
    generatedOn: todayJst(deps.now()),
    granularity: options.granularity,
    estimators: baseline?.estimators ?? ref.company.quoteStaff,
    baselineLabel,
    baselineRecords,
    baselineEstimatedRows: countEstimatedRows(baseline?.rows ?? []),
    postLabel,
    postRecords,
  });
  return {
    report,
    source,
    demoAvailable: pilot !== null,
    baselineOrigin,
    baselineNote: baseline?.note ?? "",
    postNote,
    baselineRows: baseline?.rows.length ?? 0,
  };
}
