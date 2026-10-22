import fs from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { createAiQuota } from "@/lib/ai/quota";
import { MODEL } from "@/lib/ai/client";
import { createMockSalesforce } from "@/lib/crm/mock";
import { todayJst } from "@/lib/dates";
import { DEMO_SCENARIOS } from "@/lib/demo/scenarios";
import type { Deps } from "@/lib/deps";
import type { Inquiry, Spec } from "@/lib/domain/inquiry";
import { fallbackProposals } from "@/lib/estimate/fallback";
import { estimateWithClaude } from "@/lib/estimate/claude";
import { extractWithClaude } from "@/lib/extraction/claude";
import { registerInquiry, runEstimate, sanitizeFileName } from "@/lib/pipeline";
import { loadReferenceData, type ReferenceData } from "@/lib/reference/load";
import { createMemoryStorage } from "@/lib/storage/memory-store";
import { buildCaseQuery, searchSimilarCases } from "@/lib/similar/search";
import { summarizeMetrics } from "@/lib/views";
import { exportDemoDataset } from "./demo-dataset";
import { CaseTimeoutError, mapLimit, withDeadline } from "./lib/concurrency";
import { selectCases, type QuoteOptions } from "./lib/cli";
import { buildEstimate, captureRequest, formatEstimate, type PlannedCall } from "./lib/estimate";
import { appendJsonl, createRunDir, writeJson, writeText } from "./lib/files";
import { PRICES_USD_PER_MTOK, usdJpy } from "./lib/prices";
import { fmtRate, median, percentile, sec, usd } from "./lib/stats";
import { loadPocDataset, type PocCase } from "./poc-data";
import { aggregate, scoreCase, searchPool, SIMILAR_MODE_LABEL, type Aggregate, type CaseScore } from "./score";

// 見積アシストの抽出・確認事項・類似検索の評価(PoC 用に、お客様のデータを読み込める)。scripts/eval-extraction.ts から呼ぶ。
// 本番と同じ入口(registerInquiry = 図面・メールの読み取り+正規化、runEstimate = 類似検索+工数案)をそのまま動かし、
// 正解データと照合する。実 API を呼ぶのは --yes のときだけ。--demo はデモ用の固定結果(評価の仕組みの動作確認。精度は100%になる)。

/** 出力トークンの想定(思考トークンを含む)。実測で置き換える(--limit 1 で確かめる) */
export const ASSUMED_OUTPUT_TOKENS = { extract: 3_500, estimate: 2_500 } as const;
/** アプリ側の打ち切り(読み取り240秒)より少し長い、1件全体の上限 */
export const CASE_DEADLINE_MS = 330_000;

export type RunEnv = {
  options: QuoteOptions;
  /** count_tokens を呼ぶクライアント(--demo のときは使わない) */
  client: Anthropic | null;
  log: (line: string) => void;
  resultsBase?: string;
  now?: () => Date;
  loadReference?: () => Promise<ReferenceData>;
  /** デモ用の図面PDFの置き場(既定 public/samples) */
  samplesDir?: string;
};

const KIND_OF = { revision: "リピート・改訂品", "missing-info": "情報不足", "short-lead": "短納期・特殊工程" } as const;

/** 既定のデータ: デモ用の引き合い3件(正解ラベルつき)。参考にする過去案件は、同じ図番の台帳の案件 */
export function demoCases(ref: ReferenceData, samplesDir = path.join(process.cwd(), "public", "samples"), today = todayJst()): PocCase[] {
  return DEMO_SCENARIOS.map((s) => ({
    id: s.id,
    kind: KIND_OF[s.id],
    receivedAt: null,
    email: s.buildEmail(today),
    drawings: s.drawings.map((d) => ({ name: d.fileName, data: new Uint8Array(fs.readFileSync(path.join(samplesDir, d.fileName))) })),
    truth: s.truth,
    expectedQuestions: s.truth.expectedQuestions,
    ownCaseId: null,
    similarCaseIds: ref.cases.filter((c) => c.drawingNumber === s.truth.drawingNumber).map((c) => c.id),
  }));
}

const receivedDate = (c: PocCase): Date => (c.receivedAt ? new Date(`${c.receivedAt}T01:00:00+09:00`) : new Date());

/** 見積もり用: 正解の値だけで作った仕様(読み取り結果の代わり)。工数案の依頼の大きさを数えるために使う */
function truthOnlySpec(c: PocCase): Spec {
  const t = c.truth;
  return {
    customerId: null,
    customerName: null,
    contactName: null,
    partName: t.partName,
    drawingNumber: t.drawingNumber,
    revision: t.revision,
    materialId: t.materialId,
    materialCandidates: [],
    quantity: t.quantity,
    dimensions: t.dimensions,
    toleranceMm: t.toleranceMm,
    surfaceTreatmentId: t.surfaceTreatmentId,
    surfaceTreatmentCandidates: [],
    heatTreatmentId: t.heatTreatmentId,
    heatTreatmentCandidates: [],
    dueDate: null,
    inspection: null,
    processType: t.dimensions?.shape === "round" ? "turning" : t.dimensions?.shape === "sheet" ? "sheet" : "milling",
    features: [],
    notes: [],
  };
}

// ---- 1件の実行 ----

export type StepRow = { step: string; mode: string; durationMs: number; model: string | null; inputTokens: number; outputTokens: number; cacheTokens: number; costUsd: number };

export type QuoteRow = {
  caseId: string;
  kind: string | null;
  status: "ok" | "error";
  failureClass: "extract_failed" | "timeout" | "infra" | null;
  error: string | null;
  mode: string | null;
  score: CaseScore | null;
  steps: StepRow[];
  totalMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  costUsd: number;
  /** 依頼したモデル以外が応答したか(サーバー側フォールバック) */
  fallbackUsed: boolean;
};

const stepRows = (inquiry: Inquiry): StepRow[] =>
  inquiry.metrics.map((m) => ({
    step: m.step,
    mode: m.mode,
    durationMs: m.durationMs,
    model: m.model,
    inputTokens: m.usage?.inputTokens ?? 0,
    outputTokens: m.usage?.outputTokens ?? 0,
    cacheTokens: m.usage ? m.usage.cacheCreationInputTokens + m.usage.cacheReadInputTokens : 0,
    costUsd: m.costUsd ?? 0,
  }));

async function runOne(env: RunEnv, poc: PocCase, ref: ReferenceData, aiMode: Deps["aiMode"]): Promise<QuoteRow> {
  const storage = createMemoryStorage();
  const caseRef: ReferenceData = { ...ref, cases: searchPool(ref, poc.ownCaseId) };
  const deps: Deps = {
    storage,
    reference: async () => caseRef,
    aiMode,
    crm: createMockSalesforce(storage.mockCrm),
    // 評価は件数が決まっているので、1日の上限では止めない
    aiQuota: createAiQuota(Number.MAX_SAFE_INTEGER),
    now: () => (poc.receivedAt ? receivedDate(poc) : (env.now ?? (() => new Date()))()),
  };
  const base = { caseId: poc.id, kind: poc.kind };
  const fail = (failureClass: NonNullable<QuoteRow["failureClass"]>, error: string, inquiry?: Inquiry): QuoteRow => ({
    ...base,
    status: "error",
    failureClass,
    error,
    mode: inquiry?.extraction.mode ?? null,
    score: null,
    steps: inquiry ? stepRows(inquiry) : [],
    totalMs: inquiry ? summarizeMetrics(inquiry).totalMs : 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheTokens: 0,
    costUsd: inquiry ? summarizeMetrics(inquiry).costUsd : 0,
    fallbackUsed: false,
  });

  try {
    let inquiry = await withDeadline(registerInquiry(deps, { email: poc.email, files: poc.drawings }), CASE_DEADLINE_MS, poc.id);
    if (aiMode === "anthropic" && inquiry.extraction.mode === "failed") return fail("extract_failed", inquiry.extraction.error ?? "AIによる読み取りに失敗しました", inquiry);
    if (env.options.withEstimate) inquiry = await withDeadline(runEstimate(deps, inquiry.id), CASE_DEADLINE_MS, poc.id);
    const m = summarizeMetrics(inquiry);
    const aiTop5 = env.options.withEstimate && inquiry.similar ? inquiry.similar.cases.map((c) => c.caseId) : null;
    return {
      ...base,
      status: "ok",
      failureClass: null,
      error: null,
      mode: inquiry.extraction.mode,
      score: scoreCase({ poc, inquiry, ref, aiTop5 }),
      steps: stepRows(inquiry),
      totalMs: m.totalMs,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
      cacheTokens: m.cacheTokens,
      costUsd: m.costUsd,
      fallbackUsed: inquiry.metrics.some((x) => x.model !== null && x.model !== MODEL),
    };
  } catch (e) {
    return fail(e instanceof CaseTimeoutError ? "timeout" : "infra", e instanceof Error ? e.message : String(e));
  }
}

// ---- 集計 ----

export type Summary = {
  generatedAt: string;
  mode: "anthropic" | "demo";
  source: string;
  model: string;
  withEstimate: boolean;
  counts: { planned: number; scored: number; errors: number };
  failureClasses: Record<string, number>;
  aggregate: Aggregate;
  fallbackUsed: number;
  cost: { totalUsd: number; meanUsd: number | null; medianUsd: number | null; maxUsd: number | null };
  latencyMs: { median: number | null; p95: number | null; max: number | null };
  tokens: { input: number; output: number; cache: number };
  steps: { step: string; calls: number; meanMs: number; totalUsd: number }[];
  prices: typeof PRICES_USD_PER_MTOK;
};

const round6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

export function summarize(rows: QuoteRow[], meta: { mode: Summary["mode"]; source: string; withEstimate: boolean; planned: number; now: Date }): Summary {
  const scored = rows.filter((r) => r.status === "ok");
  const costs = scored.map((r) => r.costUsd);
  const failureClasses: Record<string, number> = {};
  for (const r of rows) if (r.failureClass) failureClasses[r.failureClass] = (failureClasses[r.failureClass] ?? 0) + 1;
  const stepNames = [...new Set(rows.flatMap((r) => r.steps.map((s) => s.step)))];
  const times = scored.map((r) => r.totalMs);
  return {
    generatedAt: meta.now.toISOString(),
    mode: meta.mode,
    source: meta.source,
    model: MODEL,
    withEstimate: meta.withEstimate,
    counts: { planned: meta.planned, scored: scored.length, errors: rows.length - scored.length },
    failureClasses,
    aggregate: aggregate(scored.map((r) => ({ caseId: r.caseId, kind: r.kind, score: r.score! }))),
    fallbackUsed: rows.filter((r) => r.fallbackUsed).length,
    // 失敗した件の費用(通信が途中まで進んだ分)も、かかった費用として合計に入れる
    cost: { totalUsd: round6(rows.reduce((s, r) => s + r.costUsd, 0)), meanUsd: costs.length ? round6(costs.reduce((a, b) => a + b, 0) / costs.length) : null, medianUsd: median(costs), maxUsd: costs.length ? Math.max(...costs) : null },
    latencyMs: { median: median(times), p95: percentile(times, 95), max: times.length ? Math.max(...times) : null },
    tokens: { input: rows.reduce((s, r) => s + r.inputTokens, 0), output: rows.reduce((s, r) => s + r.outputTokens, 0), cache: rows.reduce((s, r) => s + r.cacheTokens, 0) },
    steps: stepNames.map((step) => {
      const ss = rows.flatMap((r) => r.steps.filter((s) => s.step === step));
      return { step, calls: ss.length, meanMs: ss.reduce((a, s) => a + s.durationMs, 0) / ss.length, totalUsd: round6(ss.reduce((a, s) => a + s.costUsd, 0)) };
    }),
    prices: PRICES_USD_PER_MTOK,
  };
}

const FIELD_NAME: Record<string, string> = {
  partName: "品名",
  drawingNumber: "図番",
  revision: "版",
  material: "材質",
  quantity: "数量",
  dimensions: "外形寸法",
  tolerance: "最小公差",
  surfaceTreatment: "表面処理",
  heatTreatment: "熱処理",
  dueDate: "希望納期",
  inspection: "検査書類",
};
const CONF_LABEL = { high: "高", medium: "中", low: "低", unknown: "不明" } as const;

export function renderMarkdown(s: Summary, rows: QuoteRow[]): string {
  const a = s.aggregate;
  const jpy = usdJpy();
  const L: string[] = [];
  L.push(`# 見積アシスト AI評価(${s.generatedAt})`, "");
  L.push(`- 方式: ${s.mode === "anthropic" ? `Claude API(${s.model})` : "デモモード(固定結果。精度は100%になる。評価の仕組みの動作確認用)"} / データ: ${s.source}${s.withEstimate ? " / 工数案(類似案件の並べ替え)も実行" : ""}`);
  L.push(`- 採点できた: ${s.counts.scored}件 / 失敗(採点対象外): ${s.counts.errors}件 / 予定: ${s.counts.planned}件`);
  if (s.fallbackUsed > 0) L.push(`- **注意: ${s.fallbackUsed}件はフォールバックで別のモデルが応答しました**`);
  L.push("- **この結果には、お客様のデータ(項目の値)が含まれます。共有・コミットしないでください。**", "");

  L.push("## 1. 読み取りの正解率(項目別)", "", "| 項目 | 正解率 |", "|---|---|");
  for (const f of a.fields) L.push(`| ${FIELD_NAME[f.key] ?? f.key} | ${fmtRate(f.rate)} |`);
  L.push(`| **全体** | ${fmtRate(a.overall)} |`);

  L.push("", "## 2. 自信のある誤り(確からしさ「高」なのに誤り。最も重視)", "", "| 確からしさ | 項目数 | 誤り | 誤りの割合 |", "|---|---|---|---|");
  for (const c of a.confidence.filter((x) => x.n > 0)) L.push(`| ${CONF_LABEL[c.level]} | ${c.n} | ${c.wrong} | ${fmtRate(c.errorRate)} |`);
  L.push("", `**自信のある誤り: ${a.confidentErrors.length}件**`);
  for (const e of a.confidentErrors) L.push(`- ${e.caseId} / ${FIELD_NAME[e.key] ?? e.key}: 正解「${e.expected}」→ 抽出「${e.actual}」`);

  const q = a.questions;
  L.push("", "## 3. 確認事項", "");
  L.push(`- 検出率(再現率): ${fmtRate(q.recall)} — 本来確認すべき項目のうち、確認事項に挙がった割合`);
  L.push(`- 的中率(挙げた確認事項のうち、正解に含まれる割合): ${fmtRate(q.precision)}`);
  L.push(`- **不要な確認事項: ${q.unnecessaryTotal}件**(1件あたり ${q.unnecessaryPerCase === null ? "—" : q.unnecessaryPerCase.toFixed(1)}件。AIが挙げたもの ${q.unnecessaryByOrigin.ai}件 / ルールが挙げたもの ${q.unnecessaryByOrigin.rule}件)`);
  if (Object.keys(q.unnecessaryFields).length > 0) L.push(`  - 項目別: ${Object.entries(q.unnecessaryFields).map(([k, v]) => `${FIELD_NAME[k] ?? k} ${v}`).join(" / ")}`);
  L.push(`- 正解の確認事項をすべて挙げられた案件: ${fmtRate(q.allFoundCases)}`);
  for (const m of q.missed) L.push(`  - 漏れ: ${m.caseId} / ${FIELD_NAME[m.field] ?? m.field}`);

  L.push("", "## 4. 類似検索の的中率(上位5件に、見積担当者が挙げた参考案件が入った案件の割合)", "");
  if (a.similar.length === 0) L.push("参考にする過去案件(similar_case_ids)の正解がある案件がないため、評価していません。");
  else {
    L.push("| 検索の方法 | 対象案件 | 上位5件に入った | 1位 | 上位3件 | 挙げた参考案件の再現率 |", "|---|---|---|---|---|---|");
    for (const m of a.similar) L.push(`| ${SIMILAR_MODE_LABEL[m.mode]} | ${m.evaluated} | ${fmtRate(m.hitAny)} | ${fmtRate(m.hitTop1)} | ${fmtRate(m.hitTop3)} | ${fmtRate(m.listedRecall)} |`);
  }

  L.push("", "## 5. 処理時間と費用(応答の usage と料金表から計算)", "", "| 指標 | 結果 |", "|---|---|");
  L.push(`| 1件あたり費用 | 平均 ${usd(s.cost.meanUsd)} / 中央値 ${usd(s.cost.medianUsd)} / 最大 ${usd(s.cost.maxUsd)}(約${s.cost.meanUsd === null ? "—" : (s.cost.meanUsd * jpy).toFixed(1)}円) |`);
  L.push(`| 全体の費用 | ${usd(s.cost.totalUsd, 2)}(約${Math.round(s.cost.totalUsd * jpy)}円) |`);
  L.push(`| 1件あたり処理時間 | 中央値 ${sec(s.latencyMs.median)} / 95%点 ${sec(s.latencyMs.p95)} / 最大 ${sec(s.latencyMs.max)} |`);
  L.push(`| トークン合計 | 入力 ${s.tokens.input.toLocaleString("ja-JP")} / 出力 ${s.tokens.output.toLocaleString("ja-JP")} / キャッシュ ${s.tokens.cache.toLocaleString("ja-JP")} |`);
  for (const st of s.steps.filter((x) => x.totalUsd > 0)) L.push(`| 手順「${st.step}」 | ${st.calls}回 / 平均 ${sec(st.meanMs)} / ${usd(st.totalUsd)} |`);

  if (a.byKind.length > 1) {
    L.push("", "## 種類別", "", "| 種類 | 件数 | 項目の正解率 | 自信のある誤り |", "|---|---|---|---|");
    for (const k of a.byKind) L.push(`| ${k.kind} | ${k.n} | ${fmtRate(k.accuracy)} | ${k.confidentErrors} |`);
  }
  const errs = rows.filter((r) => r.status === "error");
  if (errs.length > 0) {
    L.push("", "## 失敗した案件(採点していません)", "");
    for (const r of errs) L.push(`- ${r.caseId}: ${r.failureClass} — ${r.error}`);
  }
  L.push("", "## 読み方", "", "- 件数が少ないため、割合には95%区間(Wilson)を付けています。合格基準(poc-plan.md 6.3)と比べるときは、区間の下限も見てください。", "- 数値の定義は docs/evals.md の「quote-assist」を参照。");
  return L.join("\n");
}

// ---- 実行 ----

export type RunOutcome = { status: "estimated" | "done" | "exported"; dir: string | null; summary: Summary | null; estimateUsd: number };

export async function runQuoteEval(env: RunEnv): Promise<RunOutcome> {
  const { options, log } = env;
  const now = env.now ?? (() => new Date());
  const ref = await (env.loadReference ?? loadReferenceData)();

  if (options.exportDemo) {
    const ids = exportDemoDataset(options.exportDemo, ref, env.samplesDir);
    log(`デモ用の引き合い ${ids.length} 件を PoC のデータの形式で書き出しました: ${options.exportDemo}\n  読み込みの確認: npm run eval -- --demo --data ${options.exportDemo}`);
    return { status: "exported", dir: options.exportDemo, summary: null, estimateUsd: 0 };
  }

  const all = options.data ? loadPocDataset(options.data, ref) : demoCases(ref, env.samplesDir, todayJst(now()));
  const selected = selectCases(all, options);
  const source = options.data ? `PoC のデータ(${options.data}、${all.length}件中${selected.length}件)` : `デモ用の引き合い(${selected.length}件)`;
  const aiMode: Deps["aiMode"] = options.demo ? "demo" : "anthropic";
  log(`方式: ${aiMode === "anthropic" ? `Claude API(${MODEL})` : "デモモード(固定結果。評価の仕組みの動作確認用。精度は100%になる)"} / データ: ${source}`);

  let estimateUsd = 0;
  if (aiMode === "anthropic") {
    if (!env.client) throw new Error("費用の見積もりに使う Anthropic クライアントがありません");
    // 1. 実行前の見積もり。アプリが実際に送る依頼(図面PDFも含む)を取り出して、count_tokens で数える
    const planned: PlannedCall[] = [];
    for (const c of selected) {
      const today = (c.receivedAt ?? todayJst(now()));
      const params = await captureRequest((client) =>
        extractWithClaude({ drawings: c.drawings.map((d) => ({ fileName: sanitizeFileName(d.name), data: d.data })), email: c.email, receivedAt: today, rates: ref.rates, client }),
      );
      planned.push({ caseId: c.id, step: "図面・メールの読み取り", params, times: 1, assumedOutputTokens: ASSUMED_OUTPUT_TOKENS.extract });
      if (options.withEstimate) {
        const spec = truthOnlySpec(c);
        const pool = searchPool(ref, c.ownCaseId);
        const candidates = searchSimilarCases(buildCaseQuery(spec, ref.rates), pool, ref.rates, ref.defects);
        if (candidates.length > 0) {
          const fallback = fallbackProposals(spec, candidates, pool, ref.rates);
          const p = await captureRequest((client) => estimateWithClaude({ spec, candidates, cases: pool, defects: ref.defects, rates: ref.rates, fallback, client }));
          planned.push({ caseId: c.id, step: "工数案の作成(類似案件の並べ替え)", params: p, times: 1, assumedOutputTokens: ASSUMED_OUTPUT_TOKENS.estimate });
        }
      }
    }
    const estimate = await buildEstimate(env.client, planned);
    estimateUsd = estimate.totals.expectedCostUsd;
    log(formatEstimate(estimate, { note: options.withEstimate ? "工数案の依頼は、読み取り結果の代わりに正解の値から作った仕様で数えています(実際は読み取り結果によって変わります)。" : undefined }));
    if (!options.yes) {
      log("\n実際の API は呼んでいません。この費用で実行するときは、同じコマンドに --yes を付けてください。");
      return { status: "estimated", dir: null, summary: null, estimateUsd };
    }
  }

  // 2. 実行。1件終わるごとに results.jsonl へ追記する
  const dir = createRunDir(env.resultsBase ?? options.out ?? path.join(process.cwd(), "evals", "results"), now());
  log(`\n実行します。結果の保存先: ${dir}(お客様のデータの値を含むので、共有・コミットしないでください)`);
  const rows = await mapLimit(selected, options.concurrency, async (poc) => {
    const row = await runOne(env, poc, ref, aiMode);
    appendJsonl(dir, row.status === "ok" ? "results.jsonl" : "errors.jsonl", row);
    const wrong = row.score?.fields.filter((f) => !f.correct).length ?? 0;
    log(`  ${poc.id}: ${row.status === "ok" ? `誤り ${wrong}項目 / 自信のある誤り ${row.score!.fields.filter((f) => !f.correct && f.confidence === "high").length} / ${sec(row.totalMs)} / ${usd(row.costUsd)}` : `失敗(${row.failureClass}: ${row.error})`}`);
    return row;
  });

  const summary = summarize(rows, { mode: aiMode, source, withEstimate: options.withEstimate, planned: selected.length, now: now() });
  writeJson(dir, "results.json", { summary, rows });
  writeText(dir, "summary.md", renderMarkdown(summary, rows));
  log(`\n${renderMarkdown(summary, rows)}`);
  log(`\n保存しました: ${dir}/summary.md ・ results.json ・ results.jsonl`);
  return { status: "done", dir, summary, estimateUsd };
}
