import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { extractReport, generateAiReport } from "@/lib/diagnosis/ai";
import { calculateDiagnosis, type DiagnosisResult } from "@/lib/diagnosis/calculate";
import { buildFallbackReport } from "@/lib/diagnosis/fallback";
import type { AiReport } from "@/lib/diagnosis/schema";
import { DIAGNOSIS_EVAL_CASES, type DiagnosisEvalCase } from "./cases";
import { DIAGNOSIS_CRITERIA, DIAGNOSIS_JUDGE_SYSTEM, judgeUserPrompt } from "./judge-criteria";
import { gradeReport, ruleTotals, type ReportGrade } from "./graders";
import { CaseTimeoutError, mapLimit, withDeadline } from "./lib/concurrency";
import { selectCases, type CommonOptions } from "./lib/cli";
import { buildEstimate, captureRequest, formatEstimate, type CapturedParams, type PlannedCall } from "./lib/estimate";
import { appendJsonl, createRunDir, writeJson, writeText } from "./lib/files";
import { CallRecorder, instrumentClient, type CallRecord } from "./lib/instrument";
import { JUDGE_MODEL, judgeSchema, passCount, runJudge, summarizeVerdicts, type JudgeVerdict } from "./lib/judge";
import { PRICES_USD_PER_MTOK, usdJpy } from "./lib/prices";
import { fmtRate, median, percentile, rateOf, sec, usd } from "./lib/stats";
import { addUsage, ZERO_USAGE, type TokenUsage } from "./lib/usage";

// 診断レポート(AI の文章)の評価の本体。scripts/eval-report.ts から呼ぶ。実 API を呼ぶのは --yes のときだけ。

/** 出力トークンの想定(思考トークンを含む)。実測で置き換える(--limit 1 で確かめる) */
export const ASSUMED_OUTPUT_TOKENS = { generate: 4_000, judge: 1_500 } as const;
/** アプリ側の打ち切り(100秒)より少し長い、1件全体の上限 */
export const CASE_DEADLINE_MS = 130_000;

export type RunEnv = {
  options: CommonOptions;
  client: Anthropic;
  log: (line: string) => void;
  /** 結果の保存先(省略時は evals/results) */
  resultsBase?: string;
  now?: () => Date;
};

type Prepared = { evalCase: DiagnosisEvalCase; result: DiagnosisResult };

const prepare = (cases: DiagnosisEvalCase[]): Prepared[] => cases.map((evalCase) => ({ evalCase, result: calculateDiagnosis(evalCase.input) }));

const promptOf = (messages: unknown): string => {
  const first = (messages as { content?: unknown }[] | null)?.[0]?.content;
  return typeof first === "string" ? first : JSON.stringify(first ?? "");
};

function judgeParams(model: string, modelPrompt: string, report: AiReport): CapturedParams {
  return {
    model,
    max_tokens: 8000,
    system: DIAGNOSIS_JUDGE_SYSTEM,
    messages: [{ role: "user", content: judgeUserPrompt(modelPrompt, report) }],
    output_config: { effort: "medium", format: { type: "json_schema", schema: betaZodOutputFormat(judgeSchema(DIAGNOSIS_CRITERIA.map((c) => c.id))).schema } },
  };
}

export type CaseRow = {
  caseId: string;
  rep: number;
  status: "ok" | "error";
  /** ok でも、検証に失敗した場合の理由(refusal / truncated / invalid_output)。error のときは infra / timeout */
  failureClass: "refusal" | "truncated" | "invalid_output" | "infra" | "timeout" | null;
  error: string | null;
  valid: boolean;
  grade: ReportGrade | null;
  judge: { model: string; verdicts: JudgeVerdict[]; error: string | null; costUsd: number; usage: TokenUsage; durationMs: number } | null;
  generate: {
    requestedModel: string;
    servedModel: string | null;
    stopReason: string | null;
    fallbackUsed: boolean;
    usage: TokenUsage;
    costUsd: number;
    durationMs: number;
  } | null;
  report: AiReport | null;
};

async function runOne(env: RunEnv, p: Prepared, rep: number, judgeModel: string): Promise<CaseRow> {
  const { evalCase, result } = p;
  const recorder = new CallRecorder();
  const instrumented = instrumentClient(env.client, recorder, () => "generate");
  const base = { caseId: evalCase.id, rep };
  try {
    await withDeadline(generateAiReport(evalCase.input, result, instrumented), CASE_DEADLINE_MS, evalCase.id);
  } catch (e) {
    // アプリが投げたエラー(辞退・出力上限・解析失敗)は、記録された応答から分類し直す。応答が無ければ通信などの失敗
    if (recorder.calls.length === 0 || recorder.calls[0].error) {
      const timeout = e instanceof CaseTimeoutError;
      return { ...base, status: "error", failureClass: timeout ? "timeout" : "infra", error: e instanceof Error ? e.message : String(e), valid: false, grade: null, judge: null, generate: null, report: null };
    }
  }
  const call = recorder.calls.find((c) => c.label === "generate");
  if (!call || call.error) {
    return { ...base, status: "error", failureClass: "infra", error: call?.error ?? "AI の呼び出しが記録されませんでした", valid: false, grade: null, judge: null, generate: null, report: null };
  }
  const generate = {
    requestedModel: call.requestedModel,
    servedModel: call.servedModel,
    stopReason: call.stopReason,
    fallbackUsed: call.fallbackUsed,
    usage: call.usage,
    costUsd: call.costUsd,
    durationMs: call.durationMs,
  };
  const report = call.stopReason === "end_turn" || call.stopReason === "stop_sequence" ? extractReport(call.content ?? []) : null;
  const failureClass = report ? null : call.stopReason === "refusal" ? "refusal" : call.stopReason === "max_tokens" ? "truncated" : "invalid_output";
  const prompt = promptOf(call.messages);
  const grade = gradeReport({ evalCase, result, prompt, report });

  let judge: CaseRow["judge"] = null;
  if (report && !env.options.noJudge) {
    const judgeRecorder = new CallRecorder();
    const outcome = await runJudge(env.client, {
      model: judgeModel,
      system: DIAGNOSIS_JUDGE_SYSTEM,
      user: judgeUserPrompt(prompt, report),
      criteria: DIAGNOSIS_CRITERIA,
      recorder: judgeRecorder,
    });
    judge = { model: judgeModel, verdicts: outcome.verdicts, error: outcome.error, costUsd: judgeRecorder.totalCostUsd, usage: judgeRecorder.totalUsage, durationMs: outcome.call?.durationMs ?? 0 };
  }
  return { ...base, status: "ok", failureClass, error: null, valid: report !== null, grade, judge, generate, report };
}

// ---- 集計 ----

export type Summary = {
  generatedAt: string;
  model: string;
  judgeModel: string | null;
  options: { reps: number; cases: string[]; noJudge: boolean };
  counts: { planned: number; scored: number; errors: number };
  validation: ReturnType<typeof rateOf>;
  hardPass: ReturnType<typeof rateOf>;
  rules: { id: string; label: string; hard: boolean; rate: ReturnType<typeof rateOf> }[];
  judge: { id: string; pass: number; fail: number; na: number; rate: number | null }[] | null;
  judgeErrors: number;
  fallbackUsed: number;
  failureClasses: Record<string, number>;
  generateCost: { totalUsd: number; meanUsd: number | null; medianUsd: number | null; maxUsd: number | null };
  judgeCostUsd: number;
  totalCostUsd: number;
  latencyMs: { median: number | null; p95: number | null; max: number | null };
  tokens: { total: TokenUsage; meanInput: number | null; meanOutput: number | null };
  apiCalls: number;
  prices: typeof PRICES_USD_PER_MTOK;
};

export function summarize(rows: CaseRow[], meta: { model: string; judgeModel: string | null; options: Summary["options"]; planned: number; now: Date }): Summary {
  const scored = rows.filter((r) => r.status === "ok");
  const gens = scored.map((r) => r.generate!);
  const costs = gens.map((g) => g.costUsd);
  const grades = scored.map((r) => r.grade!).filter(Boolean);
  const judged = scored.filter((r) => r.judge && !r.judge.error).map((r) => r.judge!.verdicts);
  const failureClasses: Record<string, number> = {};
  for (const r of rows) if (r.failureClass) failureClasses[r.failureClass] = (failureClasses[r.failureClass] ?? 0) + 1;
  const total = gens.reduce((a, g) => addUsage(a, g.usage), ZERO_USAGE);
  const judgeCostUsd = round6(scored.reduce((s, r) => s + (r.judge?.costUsd ?? 0), 0));
  const generateTotal = round6(costs.reduce((a, b) => a + b, 0));
  const durations = gens.map((g) => g.durationMs);
  return {
    generatedAt: meta.now.toISOString(),
    model: meta.model,
    judgeModel: meta.judgeModel,
    options: meta.options,
    counts: { planned: meta.planned, scored: scored.length, errors: rows.length - scored.length },
    validation: rateOf(scored.filter((r) => r.valid).length, scored.length),
    hardPass: rateOf(scored.filter((r) => r.grade?.pass).length, scored.length),
    rules: ruleTotals(grades).map((t) => ({ id: t.id, label: t.label, hard: t.hard, rate: rateOf(t.pass, t.n) })),
    judge: meta.judgeModel ? summarizeVerdicts(judged, DIAGNOSIS_CRITERIA) : null,
    judgeErrors: scored.filter((r) => r.judge?.error).length,
    fallbackUsed: gens.filter((g) => g.fallbackUsed).length,
    failureClasses,
    generateCost: { totalUsd: generateTotal, meanUsd: costs.length ? generateTotal / costs.length : null, medianUsd: median(costs), maxUsd: costs.length ? Math.max(...costs) : null },
    judgeCostUsd,
    totalCostUsd: round6(generateTotal + judgeCostUsd),
    latencyMs: { median: median(durations), p95: percentile(durations, 95), max: durations.length ? Math.max(...durations) : null },
    tokens: {
      total,
      meanInput: gens.length ? (total.inputTokens + total.cacheReadInputTokens + total.cacheCreationInputTokens) / gens.length : null,
      meanOutput: gens.length ? total.outputTokens / gens.length : null,
    },
    apiCalls: gens.length + scored.filter((r) => r.judge).length,
    prices: PRICES_USD_PER_MTOK,
  };
}

const round6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

export function renderMarkdown(s: Summary, rows: CaseRow[]): string {
  const jpy = usdJpy();
  const L: string[] = [];
  L.push(`# 診断レポート AI評価(${s.generatedAt})`, "");
  L.push(`- 生成モデル: ${s.model} / 採点モデル: ${s.judgeModel ?? "(LLM採点なし)"}`);
  L.push(`- 入力: ${s.options.cases.length}件 × ${s.options.reps}回(${s.options.cases.join(", ")})`);
  L.push(`- 採点できた: ${s.counts.scored}件 / 通信などの失敗(採点対象外): ${s.counts.errors}件 / 予定: ${s.counts.planned}件`);
  if (s.fallbackUsed > 0) L.push(`- **注意: ${s.fallbackUsed}件はフォールバックで別のモデルが応答しました**(品質の比較に使うときは除いて読む)`);
  L.push("", "## 結果の要約", "");
  L.push(`| 指標 | 結果 |`, `|---|---|`);
  L.push(`| 構造化出力の検証成功率 | ${fmtRate(s.validation)} |`);
  L.push(`| 規則による採点: 全部の必須規則に合格 | ${fmtRate(s.hardPass)} |`);
  L.push(`| API 呼び出し回数 | ${s.apiCalls} 回(生成 ${s.counts.scored} + 採点 ${s.apiCalls - s.counts.scored}) |`);
  L.push(`| 1件あたり費用(生成のみ) | 平均 ${usd(s.generateCost.meanUsd)} / 中央値 ${usd(s.generateCost.medianUsd)} / 最大 ${usd(s.generateCost.maxUsd)}(約${s.generateCost.meanUsd === null ? "—" : Math.round(s.generateCost.meanUsd * jpy)}円) |`);
  L.push(`| 全体の費用 | ${usd(s.totalCostUsd, 2)}(生成 ${usd(s.generateCost.totalUsd, 2)} + 採点 ${usd(s.judgeCostUsd, 2)}、約${Math.round(s.totalCostUsd * jpy)}円) |`);
  L.push(`| 生成の所要時間 | 中央値 ${sec(s.latencyMs.median)} / 95%点 ${sec(s.latencyMs.p95)} / 最大 ${sec(s.latencyMs.max)} |`);
  L.push(`| 生成1件のトークン | 入力 平均 ${s.tokens.meanInput?.toFixed(0) ?? "—"} / 出力 平均 ${s.tokens.meanOutput?.toFixed(0) ?? "—"} |`);
  if (Object.keys(s.failureClasses).length > 0) L.push(`| 失敗の内訳 | ${Object.entries(s.failureClasses).map(([k, v]) => `${k} ${v}`).join(" / ")} |`);
  L.push("", "## 規則ごとの合格率", "", "| 規則 | 区分 | 合格率 |", "|---|---|---|");
  for (const r of s.rules) L.push(`| ${r.label} | ${r.hard ? "必須" : "参考"} | ${fmtRate(r.rate)} |`);
  if (s.judge) {
    L.push("", "## LLM採点(観点ごとの pass の割合。na は除く)", "");
    L.push("| 観点 | pass | fail | na | 割合 |", "|---|---|---|---|---|");
    for (const j of s.judge) L.push(`| ${j.id} | ${j.pass} | ${j.fail} | ${j.na} | ${j.rate === null ? "—" : `${(j.rate * 100).toFixed(0)}%`} |`);
    if (s.judgeErrors > 0) L.push("", `採点そのものが失敗した件: ${s.judgeErrors}件(集計から除いています)`);
  }
  L.push("", "## 1件ごと", "", "| 件 | 回 | 状態 | 検証 | 必須規則 | 費用 | 時間 | 不合格の規則 |", "|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const failed = r.grade?.rules.filter((x) => x.applicable && x.hard && !x.pass).map((x) => x.id).join(", ") ?? "";
    L.push(
      `| ${r.caseId} | ${r.rep} | ${r.status === "ok" ? "採点済み" : `失敗(${r.failureClass})`} | ${r.valid ? "○" : "×"} | ${r.grade ? (r.grade.pass ? "合格" : "不合格") : "—"} | ${usd(r.generate?.costUsd ?? null)} | ${sec(r.generate?.durationMs ?? null)} | ${failed || (r.error ?? "")} |`,
    );
  }
  const details = rows.filter((r) => r.grade?.rules.some((x) => x.applicable && x.detail.length > 0));
  if (details.length > 0) {
    L.push("", "## 規則が見つけた点(誤検出の可能性があるので、文章を読んで確かめる)", "");
    for (const r of details) {
      for (const x of r.grade!.rules.filter((y) => y.applicable && y.detail.length > 0)) {
        L.push(`- **${r.caseId}#${r.rep}** ${x.label}(${x.hard ? "必須" : "参考"}): ${x.detail.slice(0, 6).join(" / ")}`);
      }
    }
  }
  L.push("", "## 読み方", "", "- 件数が少ないため、割合には95%区間(Wilson)を付けています。区間が広いので、大きな劣化の検出に使い、小さな差は回数(--reps)を増やして確かめます。", "- 費用は応答の usage と料金表(evals/lib/prices.ts)から計算しています。詳しくは docs/evals.md。");
  return L.join("\n");
}

// ---- 実行 ----

export type RunOutcome = { status: "estimated" | "done"; dir: string | null; summary: Summary | null; estimateUsd: number };

export async function runDiagnosisEval(env: RunEnv): Promise<RunOutcome> {
  const { options, client, log } = env;
  const now = env.now ?? (() => new Date());
  const selected = prepare(selectCases(DIAGNOSIS_EVAL_CASES, options));
  const judgeModel = options.noJudge ? null : (options.judgeModel ?? JUDGE_MODEL);

  // 1. 実行前の見積もり。アプリが実際に送る依頼を取り出して、count_tokens で数える
  const planned: PlannedCall[] = [];
  for (const p of selected) {
    const params = await captureRequest((c) => generateAiReport(p.evalCase.input, p.result, c));
    planned.push({ caseId: p.evalCase.id, step: "レポート生成", params, times: options.reps, assumedOutputTokens: ASSUMED_OUTPUT_TOKENS.generate });
    if (judgeModel) {
      // 採点の入力は生成の出力に依存するので、同じ形の標準レポートで代用して数える
      const stand = buildFallbackReport(p.result);
      planned.push({ caseId: p.evalCase.id, step: "LLM採点", params: judgeParams(judgeModel, promptOf(params.messages), stand), times: options.reps, assumedOutputTokens: ASSUMED_OUTPUT_TOKENS.judge });
    }
  }
  const estimate = await buildEstimate(client, planned);
  log(formatEstimate(estimate));
  if (!options.yes) {
    log("\n実際の API は呼んでいません。この費用で実行するときは、同じコマンドに --yes を付けてください。");
    return { status: "estimated", dir: null, summary: null, estimateUsd: estimate.totals.expectedCostUsd };
  }

  // 2. 実行。1件終わるごとに results.jsonl へ追記する(途中で止まっても、終わった分は残る)
  const dir = createRunDir(env.resultsBase ?? options.out ?? path.join(process.cwd(), "evals", "results"), now());
  log(`\n実行します。結果の保存先: ${dir}`);
  const jobs = selected.flatMap((p) => Array.from({ length: options.reps }, (_, rep) => ({ p, rep: rep + 1 })));
  const rows = await mapLimit(jobs, options.concurrency, async ({ p, rep }) => {
    const row = await runOne(env, p, rep, judgeModel ?? JUDGE_MODEL);
    appendJsonl(dir, row.status === "ok" ? "results.jsonl" : "errors.jsonl", row);
    log(`  ${p.evalCase.id}#${rep}: ${row.status === "ok" ? `${row.valid ? "検証OK" : `検証NG(${row.failureClass})`} / 必須規則 ${row.grade?.pass ? "合格" : "不合格"} / ${usd(row.generate?.costUsd ?? null)}` : `失敗(${row.failureClass}: ${row.error})`}`);
    return row;
  });

  const model = rows.find((r) => r.generate)?.generate?.requestedModel ?? planned[0]?.params.model ?? "";
  const summary = summarize(rows, {
    model,
    judgeModel,
    options: { reps: options.reps, cases: selected.map((s) => s.evalCase.id), noJudge: options.noJudge },
    planned: jobs.length,
    now: now(),
  });
  writeJson(dir, "results.json", { summary, estimate, rows });
  writeText(dir, "summary.md", renderMarkdown(summary, rows));
  log(`\n${renderMarkdown(summary, rows)}`);
  log(`\n保存しました: ${dir}/summary.md ・ results.json ・ results.jsonl`);
  return { status: "done", dir, summary, estimateUsd: estimate.totals.expectedCostUsd };
}

// ---- 採点者の自己点検(--judge-selftest) ----
// 空の文章と、的外れで断定的な文章に、採点者が pass を付けないことを確かめる(付けたら採点の基準か採点者を見直す)。

const blank = (): AiReport => ({ summary: "", recommendations: [], roadmap: [], readinessAdvice: [], discussionPoints: [] });
const offTopic = (): AiReport => ({
  summary: "今日の天気は晴れです。この会社は必ず100%成功することを保証します。誰でもすぐできます。",
  recommendations: [{ taskId: "inquiry", title: "おいしいカレーの作り方", approach: "玉ねぎを炒めてください。", tools: ["鍋", "包丁"], firstStep: "野菜を買う", caution: "特になし" }],
  roadmap: [{ period: "1ヶ月目", goal: "カレーを作る", actions: ["買い物", "調理"] }],
  readinessAdvice: ["よく寝る"],
  discussionPoints: ["特になし"],
});

export async function runJudgeSelftest(env: RunEnv): Promise<{ ok: boolean }> {
  const { options, client, log } = env;
  const judgeModel = options.judgeModel ?? JUDGE_MODEL;
  const base = prepare([DIAGNOSIS_EVAL_CASES[0]])[0];
  const prompt = promptOf((await captureRequest((c) => generateAiReport(base.evalCase.input, base.result, c))).messages);
  const controls = [
    { name: "空の文章", report: blank() },
    { name: "的外れで断定的な文章", report: offTopic() },
  ];
  const planned: PlannedCall[] = controls.map((c) => ({ caseId: "judge-selftest", step: `採点: ${c.name}`, params: judgeParams(judgeModel, prompt, c.report), times: 1, assumedOutputTokens: ASSUMED_OUTPUT_TOKENS.judge }));
  const estimate = await buildEstimate(client, planned);
  log(formatEstimate(estimate));
  if (!options.yes) {
    log("\n実際の API は呼んでいません。実行するときは --yes を付けてください。");
    return { ok: true };
  }
  let ok = true;
  for (const c of controls) {
    const recorder = new CallRecorder();
    const out = await runJudge(client, { model: judgeModel, system: DIAGNOSIS_JUDGE_SYSTEM, user: judgeUserPrompt(prompt, c.report), criteria: DIAGNOSIS_CRITERIA, recorder });
    const passes = out.error ? -1 : passCount(out.verdicts);
    // 「na」は前提がないという判定なので、空・的外れな文章には付かないはず。pass が1つでもあれば、基準が甘い
    log(`  ${c.name}: ${out.error ? `採点失敗(${out.error})` : `pass ${passes} / ${out.verdicts.length}観点`}${passes > 0 ? "  ← 想定外(pass が付いた観点: " + out.verdicts.filter((v) => v.verdict === "pass").map((v) => v.id).join(", ") + ")" : ""}`);
    if (out.error || passes > 0) ok = false;
  }
  log(ok ? "\n自己点検: 合格(空・的外れな文章に pass を付けませんでした)" : "\n自己点検: 要確認(上の想定外の判定を読んで、観点の文か採点者の指示を直してください)");
  return { ok };
}

export type { CallRecord };
