import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { analyzeFile } from "../src/analyzeFile";
import {
  AiGenerationError,
  createClaudeClient,
  factsText,
  generateAiDocument,
  jsonSchemaFormat,
  MODEL,
  type StructuredClient,
  type StructuredRequest,
} from "../src/doc/ai";
import { AiOverallSchema, ModuleSummariesSchema, type AiDocument, type AiOverallRaw } from "../src/doc/aiSchema";
import { renderMarkdown } from "../src/doc/markdown";
import type { InventoryReport } from "../src/schema";
import { casePath, INVENTORY_EVAL_CASES, type InventoryEvalCase } from "./cases";
import { gradeDocument, ruleTotals, type DocumentGrade } from "./graders";
import { INVENTORY_CRITERIA, INVENTORY_JUDGE_SYSTEM, judgeUserPrompt } from "./judge-criteria";
import { CaseTimeoutError, mapLimit, withDeadline } from "./lib/concurrency";
import { selectCases, type CommonOptions } from "./lib/cli";
import { buildEstimate, formatEstimate, type CapturedParams, type PlannedCall } from "./lib/estimate";
import { appendJsonl, createRunDir, writeJson, writeText } from "./lib/files";
import { CallRecorder, instrumentClient, type CallRecord } from "./lib/instrument";
import { JUDGE_MODEL, judgeSchema, passCount, runJudge, summarizeVerdicts, type JudgeVerdict } from "./lib/judge";
import { PRICES_USD_PER_MTOK, usdJpy } from "./lib/prices";
import { fmtRate, median, percentile, rateOf, sec, usd } from "./lib/stats";
import { addUsage, ZERO_USAGE, type TokenUsage } from "./lib/usage";


// 仕様書(Excel/VBA・Access の棚卸し)の評価の本体。scripts/eval-document.ts から呼ぶ。実 API を呼ぶのは --yes のときだけ。
// 本番と同じ入口(generateAiDocument: モジュール要約 map → 全体統合 reduce)を、計測つきの Claude クライアントで動かす。

/** 出力トークンの想定(思考トークンを含む)。実測で置き換える(--limit 1 で確かめる) */
export const ASSUMED_OUTPUT_TOKENS = { mapBase: 600, mapPerProcedure: 110, reduce: 7_000, judge: 1_500 } as const;
/** 採点者に渡す AI の文章の想定トークン(見積もりでは、実際の文章を作る前なので足して数える) */
export const ASSUMED_OVERALL_TOKENS = 2_500;
/** 1サンプル全体の上限(1回の依頼の上限は本番と同じ8分) */
export const CASE_DEADLINE_MS = 20 * 60_000;

export type RunEnv = {
  options: CommonOptions;
  client: Anthropic;
  log: (line: string) => void;
  resultsBase?: string;
  now?: () => Date;
};

const classify = (p: { system?: unknown }): string => (typeof p.system === "string" && p.system.includes("棚卸ししています") ? "map" : "reduce");

// ---- 見積もり用の取り出し: 本物の generateAiDocument を、API を呼ばない StructuredClient で動かす ----

const PLACEHOLDER_PURPOSE = "このモジュールは、受注の入力と請求書の発行に使う処理をまとめたものと思われます。";
const PLACEHOLDER_SUMMARY = "入力内容を確認して、シートに書き込む処理と思われます。";
const SYNTHETIC_OVERALL: AiOverallRaw = {
  overview: "営業事務が受注を入力して請求書を発行するための仕組みと思われます。".repeat(3),
  businessFlow: {
    summary: "利用者が入力し、マクロが保存と印刷を行う流れと推定されます。",
    steps: [
      { id: "s1", label: "受注を入力する", actor: "利用者", next: ["s2"] },
      { id: "s2", label: "データベースへ保存する", actor: "マクロ", next: ["s3"] },
      { id: "s3", label: "請求書を発行する", actor: "マクロ", next: [] },
    ],
  },
  risks: [1, 2, 3].map((n) => ({ title: `リスク${n}`, severity: "中", detail: "担当者が異動するとパスが変わり、動かなくなるおそれがあります。".repeat(2), ruleIds: [], recommendation: "設定シートに保存先を集約してください。" })),
  migrations: [1, 2].map((n) => ({ target: `移行先${n}(ノーコード業務アプリ等)`, fit: "高", difficulty: "中", reason: "入力画面と台帳の管理が中心のため。", approach: "まず入力画面と一覧を置き換えます。", concerns: "帳票の再現に手間がかかります。" })),
  recommendation: "まず現状の手順を記録し、段階的に置き換えることをおすすめします。",
  hearingItems: ["いつから使っていますか。", "止まったときは誰が対応しますか。", "月末の運用手順はありますか。"],
};

type Captured = { req: StructuredRequest<z.ZodType>; procedures: number };

function dryClient(captured: Captured[]): StructuredClient {
  return {
    async generate<S extends z.ZodType>(req: StructuredRequest<S>): Promise<z.infer<S>> {
      if ((req.schema as z.ZodType) === ModuleSummariesSchema) {
        const modules = [...req.user.matchAll(/<module name="([^"]*)"[^>]*>\n要約するプロシージャ: ([^\n]*)\n/g)].map((m) => ({
          moduleName: m[1],
          purpose: PLACEHOLDER_PURPOSE,
          procedures: m[2].startsWith("(なし") ? [] : m[2].split("、").map((name) => ({ name, summary: PLACEHOLDER_SUMMARY })),
          concerns: [],
        }));
        captured.push({ req, procedures: modules.reduce((s, m) => s + m.procedures.length, 0) });
        return { modules } as z.infer<S>;
      }
      captured.push({ req, procedures: 0 });
      return SYNTHETIC_OVERALL as z.infer<S>;
    },
  };
}

const toParams = (req: StructuredRequest<z.ZodType>): CapturedParams => ({
  model: MODEL,
  max_tokens: req.maxTokens,
  system: req.system,
  messages: [{ role: "user", content: req.user }],
  output_config: { effort: req.effort, format: jsonSchemaFormat(req.schema) },
});

function judgeParams(model: string, facts: string, overall: AiOverallRaw): CapturedParams {
  return {
    model,
    max_tokens: 8000,
    system: INVENTORY_JUDGE_SYSTEM,
    messages: [{ role: "user", content: judgeUserPrompt(facts, overall as never) }],
    output_config: { effort: "medium", format: { type: "json_schema", schema: betaZodOutputFormat(judgeSchema(INVENTORY_CRITERIA.map((c) => c.id))).schema } },
  };
}

async function loadReport(c: InventoryEvalCase): Promise<InventoryReport> {
  const report = await analyzeFile(casePath(c));
  return c.injection ? c.injection.inject(report) : report;
}

// ---- 1サンプルの実行 ----

export type FailureClass = "refusal" | "truncated" | "invalid_output" | "infra" | "timeout";

export type CallSummary = { label: string; durationMs: number; usage: TokenUsage; costUsd: number; stopReason: string | null; servedModel: string | null; fallbackUsed: boolean; error: string | null };

export type CaseRow = {
  caseId: string;
  rep: number;
  status: "ok" | "error";
  failureClass: FailureClass | null;
  error: string | null;
  valid: boolean;
  grade: DocumentGrade | null;
  judge: { model: string; verdicts: JudgeVerdict[]; error: string | null; costUsd: number; usage: TokenUsage; durationMs: number } | null;
  generate: {
    /** 生成全体の所要時間(map の同時実行を含む。実時間) */
    wallMs: number;
    apiCalls: number;
    callsOk: number;
    callsFailed: number;
    usage: TokenUsage;
    costUsd: number;
    fallbackUsed: number;
    calls: CallSummary[];
  } | null;
  ai: { overall: AiDocument["overall"]; modules: Record<string, { purpose: string; concerns: string[]; procedures: Record<string, string> }>; notes: string[] } | null;
};

function failureOf(e: unknown): FailureClass {
  if (e instanceof CaseTimeoutError) return "timeout";
  if (e instanceof AiGenerationError) {
    if (e.message.includes("辞退")) return "refusal";
    if (e.message.includes("上限に達しました")) return "truncated";
    if (e.message.includes("解析できませんでした")) return "invalid_output";
    return "timeout";
  }
  return "infra";
}

const messageText = (c: CallRecord): string => {
  const first = (c.messages as { content?: unknown }[] | null)?.[0]?.content;
  return typeof first === "string" ? first : JSON.stringify(first ?? "");
};

async function runOne(env: RunEnv, c: InventoryEvalCase, rep: number, judgeModel: string): Promise<CaseRow> {
  const base = { caseId: c.id, rep };
  let report: InventoryReport;
  try {
    report = await loadReport(c);
  } catch (e) {
    return { ...base, status: "error", failureClass: "infra", error: `ファイルの解析に失敗: ${e instanceof Error ? e.message : String(e)}`, valid: false, grade: null, judge: null, generate: null, ai: null };
  }
  const recorder = new CallRecorder();
  const inner = createClaudeClient(instrumentClient(env.client, recorder, classify));
  let callsOk = 0;
  let callsFailed = 0;
  const counting: StructuredClient = {
    async generate(req) {
      try {
        const r = await inner.generate(req);
        callsOk++;
        return r;
      } catch (e) {
        callsFailed++;
        throw e;
      }
    },
  };
  const started = performance.now();
  let ai: AiDocument | null = null;
  let thrown: unknown = null;
  try {
    ai = await withDeadline(generateAiDocument(report, counting, { concurrency: 3 }), CASE_DEADLINE_MS, c.id);
  } catch (e) {
    thrown = e;
  }
  const wallMs = Math.round(performance.now() - started);
  const failure = thrown ? failureOf(thrown) : null;
  if (failure === "infra" || failure === "timeout") {
    return { ...base, status: "error", failureClass: failure, error: thrown instanceof Error ? thrown.message : String(thrown), valid: false, grade: null, judge: null, generate: summarizeCalls(recorder, wallMs, callsOk, callsFailed), ai: null };
  }

  const markdown = renderMarkdown(report, ai ? { ai } : { aiError: thrown instanceof Error ? thrown.message : String(thrown) });
  const requestTexts = recorder.calls.map((x) => `${typeof x.system === "string" ? x.system : JSON.stringify(x.system)}\n${messageText(x)}`);
  const reduceCall = recorder.calls.find((x) => x.label === "reduce");
  const grade = gradeDocument({ evalCase: c, report, ai, markdown, requestTexts, reduceInput: reduceCall ? messageText(reduceCall) : "" });

  let judge: CaseRow["judge"] = null;
  if (ai && !env.options.noJudge) {
    const judgeRecorder = new CallRecorder();
    const outcome = await runJudge(env.client, {
      model: judgeModel,
      system: INVENTORY_JUDGE_SYSTEM,
      user: judgeUserPrompt(factsText(report), ai.overall as never, c.injection?.text),
      criteria: INVENTORY_CRITERIA,
      recorder: judgeRecorder,
    });
    judge = { model: judgeModel, verdicts: outcome.verdicts, error: outcome.error, costUsd: judgeRecorder.totalCostUsd, usage: judgeRecorder.totalUsage, durationMs: outcome.call?.durationMs ?? 0 };
  }
  return {
    ...base,
    status: "ok",
    failureClass: failure,
    error: null,
    valid: ai !== null,
    grade,
    judge,
    generate: summarizeCalls(recorder, wallMs, callsOk, callsFailed),
    ai: ai
      ? {
          overall: ai.overall,
          modules: Object.fromEntries([...ai.modules].map(([n, m]) => [n, { purpose: m.purpose, concerns: m.concerns, procedures: Object.fromEntries(m.procedures) }])),
          notes: ai.notes,
        }
      : null,
  };
}

function summarizeCalls(recorder: CallRecorder, wallMs: number, callsOk: number, callsFailed: number): NonNullable<CaseRow["generate"]> {
  return {
    wallMs,
    apiCalls: recorder.calls.length,
    callsOk,
    callsFailed,
    usage: recorder.totalUsage,
    costUsd: recorder.totalCostUsd,
    fallbackUsed: recorder.calls.filter((x) => x.fallbackUsed).length,
    calls: recorder.calls.map((x) => ({ label: x.label, durationMs: x.durationMs, usage: x.usage, costUsd: x.costUsd, stopReason: x.stopReason, servedModel: x.servedModel, fallbackUsed: x.fallbackUsed, error: x.error })),
  };
}

// ---- 集計 ----

export type Summary = {
  generatedAt: string;
  model: string;
  judgeModel: string | null;
  options: { reps: number; cases: string[]; noJudge: boolean };
  counts: { planned: number; scored: number; errors: number };
  /** サンプル(文書)単位: 全体の生成が最後まで成功した割合 */
  validation: ReturnType<typeof rateOf>;
  /** API 呼び出し単位: 構造化出力の検証に成功した割合 */
  callValidation: ReturnType<typeof rateOf>;
  hardPass: ReturnType<typeof rateOf>;
  rules: { id: string; label: string; hard: boolean; rate: ReturnType<typeof rateOf> }[];
  procedureCoverage: number | null;
  judge: { id: string; pass: number; fail: number; na: number; rate: number | null }[] | null;
  judgeErrors: number;
  fallbackUsedCalls: number;
  failureClasses: Record<string, number>;
  generateCostUsd: number;
  judgeCostUsd: number;
  totalCostUsd: number;
  perCaseCostUsd: { mean: number | null; median: number | null; max: number | null };
  wallMs: { median: number | null; p95: number | null; max: number | null };
  tokens: { total: TokenUsage };
  apiCalls: { generate: number; judge: number; total: number };
  prices: typeof PRICES_USD_PER_MTOK;
};

const round6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

export function summarize(rows: CaseRow[], meta: { model: string; judgeModel: string | null; options: Summary["options"]; planned: number; now: Date }): Summary {
  const scored = rows.filter((r) => r.status === "ok");
  const gens = scored.map((r) => r.generate!);
  const failureClasses: Record<string, number> = {};
  for (const r of rows) if (r.failureClass) failureClasses[r.failureClass] = (failureClasses[r.failureClass] ?? 0) + 1;
  const costs = gens.map((g) => g.costUsd + 0);
  const judgeCostUsd = round6(scored.reduce((s, r) => s + (r.judge?.costUsd ?? 0), 0));
  // エラー(通信の失敗など)の行でも、すでにかかった費用は合計に入れる
  const generateCostUsd = round6(rows.reduce((s, r) => s + (r.generate?.costUsd ?? 0), 0));
  const judged = scored.filter((r) => r.judge && !r.judge.error).map((r) => r.judge!.verdicts);
  const coverage = scored.flatMap((r) => r.grade?.rules.filter((x) => x.id === "procedure_summary_coverage" && x.applicable && x.value !== undefined).map((x) => x.value!) ?? []);
  const allCalls = rows.flatMap((r) => r.generate?.calls ?? []);
  const callOk = rows.reduce((s, r) => s + (r.generate?.callsOk ?? 0), 0);
  const callFail = rows.reduce((s, r) => s + (r.generate?.callsFailed ?? 0), 0);
  const total = rows.reduce((a, r) => (r.generate ? addUsage(a, r.generate.usage) : a), ZERO_USAGE);
  const walls = gens.map((g) => g.wallMs);
  const judgeCalls = scored.filter((r) => r.judge).length;
  return {
    generatedAt: meta.now.toISOString(),
    model: meta.model,
    judgeModel: meta.judgeModel,
    options: meta.options,
    counts: { planned: meta.planned, scored: scored.length, errors: rows.length - scored.length },
    validation: rateOf(scored.filter((r) => r.valid).length, scored.length),
    callValidation: rateOf(callOk, callOk + callFail),
    hardPass: rateOf(scored.filter((r) => r.grade?.pass).length, scored.length),
    rules: ruleTotals(scored.map((r) => r.grade!).filter(Boolean)).map((t) => ({ id: t.id, label: t.label, hard: t.hard, rate: rateOf(t.pass, t.n) })),
    procedureCoverage: coverage.length ? coverage.reduce((a, b) => a + b, 0) / coverage.length : null,
    judge: meta.judgeModel ? summarizeVerdicts(judged, INVENTORY_CRITERIA) : null,
    judgeErrors: scored.filter((r) => r.judge?.error).length,
    fallbackUsedCalls: allCalls.filter((c) => c.fallbackUsed).length,
    failureClasses,
    generateCostUsd,
    judgeCostUsd,
    totalCostUsd: round6(generateCostUsd + judgeCostUsd),
    perCaseCostUsd: { mean: costs.length ? round6(costs.reduce((a, b) => a + b, 0) / costs.length) : null, median: median(costs), max: costs.length ? Math.max(...costs) : null },
    wallMs: { median: median(walls), p95: percentile(walls, 95), max: walls.length ? Math.max(...walls) : null },
    tokens: { total },
    apiCalls: { generate: allCalls.length, judge: judgeCalls, total: allCalls.length + judgeCalls },
    prices: PRICES_USD_PER_MTOK,
  };
}

export function renderMarkdownSummary(s: Summary, rows: CaseRow[]): string {
  const jpy = usdJpy();
  const L: string[] = [];
  L.push(`# 仕様書 AI評価(${s.generatedAt})`, "");
  L.push(`- 生成モデル: ${s.model} / 採点モデル: ${s.judgeModel ?? "(LLM採点なし)"}`);
  L.push(`- 入力: ${s.options.cases.length}本 × ${s.options.reps}回(${s.options.cases.join(", ")})`);
  L.push(`- 採点できた: ${s.counts.scored}件 / 通信などの失敗(採点対象外): ${s.counts.errors}件 / 予定: ${s.counts.planned}件`);
  if (s.fallbackUsedCalls > 0) L.push(`- **注意: ${s.fallbackUsedCalls}回の呼び出しは、フォールバックで別のモデルが応答しました**(品質の比較に使うときは除いて読む)`);
  L.push("", "## 結果の要約", "", "| 指標 | 結果 |", "|---|---|");
  L.push(`| 仕様書ごとの検証成功率(全体の生成が最後まで成功) | ${fmtRate(s.validation)} |`);
  L.push(`| 呼び出しごとの検証成功率(構造化出力) | ${fmtRate(s.callValidation)} |`);
  L.push(`| 規則による採点: 全部の必須規則に合格 | ${fmtRate(s.hardPass)} |`);
  L.push(`| プロシージャ要約の網羅率(平均) | ${s.procedureCoverage === null ? "—" : `${(s.procedureCoverage * 100).toFixed(0)}%`} |`);
  L.push(`| API 呼び出し回数 | ${s.apiCalls.total} 回(生成 ${s.apiCalls.generate} + 採点 ${s.apiCalls.judge}) |`);
  L.push(`| 1本あたり費用(生成のみ) | 平均 ${usd(s.perCaseCostUsd.mean)} / 中央値 ${usd(s.perCaseCostUsd.median)} / 最大 ${usd(s.perCaseCostUsd.max)}(約${s.perCaseCostUsd.mean === null ? "—" : Math.round(s.perCaseCostUsd.mean * jpy)}円) |`);
  L.push(`| 全体の費用 | ${usd(s.totalCostUsd, 2)}(生成 ${usd(s.generateCostUsd, 2)} + 採点 ${usd(s.judgeCostUsd, 2)}、約${Math.round(s.totalCostUsd * jpy)}円) |`);
  L.push(`| 1本の所要時間(実時間) | 中央値 ${sec(s.wallMs.median)} / 95%点 ${sec(s.wallMs.p95)} / 最大 ${sec(s.wallMs.max)} |`);
  if (Object.keys(s.failureClasses).length > 0) L.push(`| 失敗の内訳 | ${Object.entries(s.failureClasses).map(([k, v]) => `${k} ${v}`).join(" / ")} |`);
  L.push("", "## 規則ごとの合格率", "", "| 規則 | 区分 | 合格率 |", "|---|---|---|");
  for (const r of s.rules) L.push(`| ${r.label} | ${r.hard ? "必須" : "参考"} | ${fmtRate(r.rate)} |`);
  if (s.judge) {
    L.push("", "## LLM採点(観点ごとの pass の割合。na は除く)", "", "| 観点 | pass | fail | na | 割合 |", "|---|---|---|---|---|");
    for (const j of s.judge) L.push(`| ${j.id} | ${j.pass} | ${j.fail} | ${j.na} | ${j.rate === null ? "—" : `${(j.rate * 100).toFixed(0)}%`} |`);
    if (s.judgeErrors > 0) L.push("", `採点そのものが失敗した件: ${s.judgeErrors}件(集計から除いています)`);
  }
  L.push("", "## 1本ごと", "", "| サンプル | 回 | 状態 | 検証 | 必須規則 | 呼び出し | 費用 | 時間 | 不合格の規則 |", "|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const failed = r.grade?.rules.filter((x) => x.applicable && x.hard && !x.pass).map((x) => x.id).join(", ") ?? "";
    L.push(
      `| ${r.caseId} | ${r.rep} | ${r.status === "ok" ? "採点済み" : `失敗(${r.failureClass})`} | ${r.valid ? "○" : "×"} | ${r.grade ? (r.grade.pass ? "合格" : "不合格") : "—"} | ${r.generate?.apiCalls ?? "—"} | ${usd(r.generate?.costUsd ?? null)} | ${sec(r.generate?.wallMs ?? null)} | ${failed || (r.error ?? "")} |`,
    );
  }
  const details = rows.filter((r) => r.grade?.rules.some((x) => x.applicable && x.detail.length > 0));
  if (details.length > 0) {
    L.push("", "## 規則が見つけた点(誤検出の可能性があるので、文章を読んで確かめる)", "");
    for (const r of details) for (const x of r.grade!.rules.filter((y) => y.applicable && y.detail.length > 0)) L.push(`- **${r.caseId}#${r.rep}** ${x.label}(${x.hard ? "必須" : "参考"}): ${x.detail.slice(0, 6).join(" / ")}`);
  }
  L.push("", "## 読み方", "", "- 件数が少ないため、割合には95%区間(Wilson)を付けています。区間が広いので、大きな劣化の検出に使い、小さな差は回数(--reps)を増やして確かめます。", "- 費用は応答の usage と料金表(evals/lib/prices.ts)から計算しています。詳しくは docs/evals.md。");
  return L.join("\n");
}

// ---- 実行 ----

export type RunOutcome = { status: "estimated" | "done"; dir: string | null; summary: Summary | null; estimateUsd: number };

export async function runInventoryEval(env: RunEnv): Promise<RunOutcome> {
  const { options, client, log } = env;
  const now = env.now ?? (() => new Date());
  const selected = selectCases(INVENTORY_EVAL_CASES, options);
  const judgeModel = options.noJudge ? null : (options.judgeModel ?? JUDGE_MODEL);

  // 1. 実行前の見積もり。本物の generateAiDocument が送る依頼を取り出し(map は全部、reduce は map の出力の代用で)、count_tokens で数える
  const planned: PlannedCall[] = [];
  for (const c of selected) {
    const report = await loadReport(c);
    const captured: Captured[] = [];
    await generateAiDocument(report, dryClient(captured), { concurrency: 1 });
    captured.forEach(({ req, procedures }, i) => {
      const isMap = req.schema === ModuleSummariesSchema;
      planned.push({
        caseId: c.id,
        step: isMap ? `モジュール要約 map ${i + 1}/${captured.length - 1}` : "全体統合 reduce",
        params: toParams(req),
        times: options.reps,
        assumedOutputTokens: isMap ? ASSUMED_OUTPUT_TOKENS.mapBase + ASSUMED_OUTPUT_TOKENS.mapPerProcedure * procedures : ASSUMED_OUTPUT_TOKENS.reduce,
      });
    });
    if (judgeModel) {
      planned.push({
        caseId: c.id,
        step: "LLM採点",
        params: judgeParams(judgeModel, factsText(report), SYNTHETIC_OVERALL),
        times: options.reps,
        assumedOutputTokens: ASSUMED_OUTPUT_TOKENS.judge,
        extraInputTokens: ASSUMED_OVERALL_TOKENS,
      });
    }
  }
  const estimate = await buildEstimate(client, planned);
  log(
    formatEstimate(estimate, {
      note: "reduce の入力は、map の出力の代わりに短い仮の要約で数えています(実際は要約が長いぶん増えます)。採点の入力には、AI の文章の想定 2,500 トークンを足しています。",
    }),
  );
  if (!options.yes) {
    log("\n実際の API は呼んでいません。この費用で実行するときは、同じコマンドに --yes を付けてください。");
    return { status: "estimated", dir: null, summary: null, estimateUsd: estimate.totals.expectedCostUsd };
  }

  // 2. 実行。1件終わるごとに results.jsonl へ追記する
  const dir = createRunDir(env.resultsBase ?? options.out ?? path.join(process.cwd(), "evals", "results"), now());
  log(`\n実行します。結果の保存先: ${dir}`);
  const jobs = selected.flatMap((c) => Array.from({ length: options.reps }, (_, rep) => ({ c, rep: rep + 1 })));
  const rows = await mapLimit(jobs, options.concurrency, async ({ c, rep }) => {
    const row = await runOne(env, c, rep, judgeModel ?? JUDGE_MODEL);
    appendJsonl(dir, row.status === "ok" ? "results.jsonl" : "errors.jsonl", row);
    log(`  ${c.id}#${rep}: ${row.status === "ok" ? `${row.valid ? "生成OK" : `生成NG(${row.failureClass})`} / 必須規則 ${row.grade?.pass ? "合格" : "不合格"} / ${row.generate?.apiCalls}回 ${usd(row.generate?.costUsd ?? null)} ${sec(row.generate?.wallMs ?? null)}` : `失敗(${row.failureClass}: ${row.error})`}`);
    return row;
  });

  const summary = summarize(rows, { model: MODEL, judgeModel, options: { reps: options.reps, cases: selected.map((c) => c.id), noJudge: options.noJudge }, planned: jobs.length, now: now() });
  writeJson(dir, "results.json", { summary, estimate, rows });
  writeText(dir, "summary.md", renderMarkdownSummary(summary, rows));
  log(`\n${renderMarkdownSummary(summary, rows)}`);
  log(`\n保存しました: ${dir}/summary.md ・ results.json ・ results.jsonl`);
  return { status: "done", dir, summary, estimateUsd: estimate.totals.expectedCostUsd };
}

// ---- 採点者の自己点検(--judge-selftest) ----

const BLANK_OVERALL: AiOverallRaw = { overview: "", businessFlow: { summary: "", steps: [] }, risks: [], migrations: [], recommendation: "", hearingItems: [] };
const OFF_TOPIC: AiOverallRaw = {
  overview: "今日は天気が良いです。このファイルは必ず100%安全で、何もしなくて大丈夫です。",
  businessFlow: { summary: "カレーを作る。", steps: [{ id: "s1", label: "野菜を切る", actor: "利用者", next: [] }] },
  risks: [{ title: "なし", severity: "低", detail: "問題はありません。", ruleIds: [], recommendation: "何もしない" }],
  migrations: [{ target: "最新のスマートフォンアプリ(製品A)に必ず乗り換える", fit: "高", difficulty: "低", reason: "流行しているため。", approach: "全部作り直す", concerns: "なし" }],
  recommendation: "すぐに全部捨てましょう。",
  hearingItems: ["特になし"],
};

export async function runJudgeSelftest(env: RunEnv): Promise<{ ok: boolean }> {
  const { options, client, log } = env;
  const judgeModel = options.judgeModel ?? JUDGE_MODEL;
  const c = INVENTORY_EVAL_CASES.find((x) => x.id === "zaiko")!;
  const facts = factsText(await loadReport(c));
  const controls = [
    { name: "空の文章", overall: BLANK_OVERALL },
    { name: "的外れで断定的な文章", overall: OFF_TOPIC },
  ];
  const planned: PlannedCall[] = controls.map((x) => ({ caseId: "judge-selftest", step: `採点: ${x.name}`, params: judgeParams(judgeModel, facts, x.overall), times: 1, assumedOutputTokens: ASSUMED_OUTPUT_TOKENS.judge }));
  const estimate = await buildEstimate(client, planned);
  log(formatEstimate(estimate));
  if (!options.yes) {
    log("\n実際の API は呼んでいません。実行するときは --yes を付けてください。");
    return { ok: true };
  }
  let ok = true;
  for (const x of controls) {
    const out = await runJudge(client, { model: judgeModel, system: INVENTORY_JUDGE_SYSTEM, user: judgeUserPrompt(facts, x.overall as never), criteria: INVENTORY_CRITERIA, recorder: new CallRecorder() });
    const passes = out.error ? -1 : passCount(out.verdicts);
    log(`  ${x.name}: ${out.error ? `採点失敗(${out.error})` : `pass ${passes} / ${out.verdicts.length}観点`}${passes > 0 ? "  ← 想定外(pass が付いた観点: " + out.verdicts.filter((v) => v.verdict === "pass").map((v) => v.id).join(", ") + ")" : ""}`);
    if (out.error || passes > 0) ok = false;
  }
  log(ok ? "\n自己点検: 合格(空・的外れな文章に pass を付けませんでした)" : "\n自己点検: 要確認(上の想定外の判定を読んで、観点の文か採点者の指示を直してください)");
  return { ok };
}
