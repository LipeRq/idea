import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { calculateDiagnosis } from "@/lib/diagnosis/calculate";
import { buildFallbackReport } from "@/lib/diagnosis/fallback";
import { DIAGNOSIS_EVAL_CASES } from "./cases";
import { DIAGNOSIS_CRITERIA } from "./judge-criteria";
import { parseCommonOptions } from "./lib/cli";
import { runDiagnosisEval, runJudgeSelftest } from "./run";

// 実際のAPIは呼ばない。client.beta.messages の stream / countTokens だけを偽物にする

type Params = { system?: unknown; messages: { content: string }[] };
const isJudge = (p: Params) => typeof p.system === "string" && p.system.includes("採点者");

const message = (text: string, over: Record<string, unknown> = {}, usage = { input_tokens: 2000, output_tokens: 1000 }) => ({
  model: "claude-opus-5-5",
  stop_reason: "end_turn",
  content: [{ type: "text", text }],
  usage,
  ...over,
});

const verdicts = (verdict: "pass" | "fail" | "na") => JSON.stringify({ verdicts: DIAGNOSIS_CRITERIA.map((c) => ({ id: c.id, verdict, evidence: "引用" })) });

/** 標準レポートを「モデルの出力」として返す偽の API。入力の試算結果から作るので、すべての必須規則に合格する */
function fakeApi(over: { generate?: (p: Params, n: number) => unknown; judge?: (p: Params) => unknown } = {}) {
  let generateCalls = 0;
  const stream = vi.fn((params: Params) => ({
    finalMessage: async () => {
      if (isJudge(params)) return (over.judge ?? (() => message(verdicts("pass"), {}, { input_tokens: 1500, output_tokens: 300 })))(params);
      const n = generateCalls++;
      if (over.generate) return over.generate(params, n);
      // どの入力の依頼かは、依頼文の「業種:」と「従業員規模:」から取り出す
      const c = DIAGNOSIS_EVAL_CASES.find((x) => params.messages[0].content.includes(`- 業種: ${x.input.industry}\n- 従業員規模: ${x.input.employees}`) && params.messages[0].content.includes(x.input.challenges ?? "記入なし"))!;
      return message(JSON.stringify(buildFallbackReport(calculateDiagnosis(c.input))));
    },
  }));
  const countTokens = vi.fn(async () => ({ input_tokens: 5000 }));
  return { client: { beta: { messages: { stream, countTokens } } } as unknown as Anthropic, stream, countTokens };
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "eval-report-"));
const env = (api: ReturnType<typeof fakeApi>, args: string[], base = tmp()) => {
  const lines: string[] = [];
  return { env: { options: parseCommonOptions(args), client: api.client, log: (l: string) => lines.push(l), resultsBase: base, now: () => new Date("2026-10-22T00:00:00Z") }, lines, base };
};

describe("診断レポートの評価の実行", () => {
  it("--yes なしでは、概算費用を表示するだけで、生成も採点も呼ばず、ファイルも作らない", async () => {
    const api = fakeApi();
    const { env: e, lines, base } = env(api, ["--limit", "3"]);
    const out = await runDiagnosisEval(e);
    expect(out.status).toBe("estimated");
    expect(api.stream).not.toHaveBeenCalled();
    // 3件 × (生成 + 採点) を count_tokens で数える
    expect(api.countTokens).toHaveBeenCalledTimes(6);
    expect(lines.join("\n")).toContain("概算費用");
    expect(lines.join("\n")).toContain("--yes");
    expect(fs.readdirSync(base)).toEqual([]);
    // 入力 5,000 / 出力 4,000(生成)・1,500(採点)の想定: 3 × ((5000×4 + 4000×20) + (5000×4 + 1500×20))/1e6
    expect(out.estimateUsd).toBeCloseTo((3 * (100_000 + 50_000)) / 1_000_000, 9);
  });

  it("--yes で実行し、費用・回数・検証率を usage から計算して、JSON と Markdown で保存する", async () => {
    const api = fakeApi();
    const { env: e, base } = env(api, ["--yes", "--limit", "2", "--concurrency", "1"]);
    const out = await runDiagnosisEval(e);
    expect(out.status).toBe("done");
    const s = out.summary!;
    expect(s.counts).toEqual({ planned: 2, scored: 2, errors: 0 });
    expect(s.validation).toMatchObject({ k: 2, n: 2 });
    expect(s.hardPass).toMatchObject({ k: 2, n: 2 });
    // 生成 (2000×4 + 1000×20)/1e6 = 0.028、採点 (1500×4 + 300×20)/1e6 = 0.012
    expect(s.generateCost.totalUsd).toBeCloseTo(0.056, 9);
    expect(s.judgeCostUsd).toBeCloseTo(0.024, 9);
    expect(s.totalCostUsd).toBeCloseTo(0.08, 9);
    expect(s.apiCalls).toBe(4);
    expect(s.model).toBe("claude-opus-5-5");
    expect(s.judge!.every((j) => j.pass === 2 || j.pass === 0)).toBe(true);
    const dir = out.dir!;
    expect(dir.startsWith(base)).toBe(true);
    expect(fs.readFileSync(path.join(dir, "results.jsonl"), "utf8").trim().split("\n")).toHaveLength(2);
    const json = JSON.parse(fs.readFileSync(path.join(dir, "results.json"), "utf8"));
    expect(json.summary.totalCostUsd).toBeCloseTo(0.08, 9);
    expect(json.rows).toHaveLength(2);
    const md = fs.readFileSync(path.join(dir, "summary.md"), "utf8");
    expect(md).toContain("構造化出力の検証成功率");
    expect(md).toContain("$0.08");
  });

  it("生成が失敗した件は errors.jsonl に分けて残し、採点も呼ばず、スコアには数えない", async () => {
    const api = fakeApi({
      generate: (_p, n) => {
        if (n === 0) throw new Error("connection reset");
        return message(JSON.stringify(buildFallbackReport(calculateDiagnosis(DIAGNOSIS_EVAL_CASES[1].input))));
      },
    });
    const { env: e } = env(api, ["--yes", "--only", "mfg-mid,construction-low", "--concurrency", "1"]);
    const out = await runDiagnosisEval(e);
    const s = out.summary!;
    expect(s.counts).toEqual({ planned: 2, scored: 1, errors: 1 });
    expect(s.failureClasses).toEqual({ infra: 1 });
    expect(s.validation).toMatchObject({ k: 1, n: 1 });
    expect(fs.readFileSync(path.join(out.dir!, "errors.jsonl"), "utf8")).toContain("connection reset");
    expect(api.stream.mock.calls.filter(([p]) => isJudge(p))).toHaveLength(1);
  });

  it("構造が壊れた出力・出力上限・辞退は、通信の失敗ではなく検証の失敗として数え、採点者には渡さない", async () => {
    const api = fakeApi({
      generate: (_p, n) => (n === 0 ? message("これはJSONではありません") : n === 1 ? message("{}", { stop_reason: "max_tokens" }) : message("", { stop_reason: "refusal" })),
    });
    const { env: e } = env(api, ["--yes", "--limit", "3", "--concurrency", "1"]);
    const s = (await runDiagnosisEval(e)).summary!;
    expect(s.counts).toEqual({ planned: 3, scored: 3, errors: 0 });
    expect(s.validation).toMatchObject({ k: 0, n: 3 });
    expect(s.failureClasses).toEqual({ invalid_output: 1, truncated: 1, refusal: 1 });
    expect(s.hardPass.k).toBe(0);
    expect(api.stream.mock.calls.filter(([p]) => isJudge(p))).toHaveLength(0);
  });

  it("フォールバックで別のモデルが応答した件を数え、そのモデルの料金で費用を出す", async () => {
    const api = fakeApi({
      generate: () => {
        const report = JSON.stringify(buildFallbackReport(calculateDiagnosis(DIAGNOSIS_EVAL_CASES[0].input)));
        return message(report, { model: "claude-sonnet-5-5" }, { input_tokens: 1_000_000, output_tokens: 0 });
      },
    });
    const { env: e } = env(api, ["--yes", "--limit", "1", "--no-judge"]);
    const s = (await runDiagnosisEval(e)).summary!;
    expect(s.fallbackUsed).toBe(1);
    expect(s.generateCost.totalUsd).toBe(2);
    expect(s.judge).toBeNull();
    expect(api.stream.mock.calls.filter(([p]) => isJudge(p))).toHaveLength(0);
  });

  it("採点そのものの失敗は、モデルの失敗とは別に数え、観点の集計から除く", async () => {
    const api = fakeApi({ judge: () => message("{壊れたJSON") });
    const { env: e } = env(api, ["--yes", "--limit", "1"]);
    const s = (await runDiagnosisEval(e)).summary!;
    expect(s.judgeErrors).toBe(1);
    expect(s.validation).toMatchObject({ k: 1, n: 1 });
    expect(s.judge!.every((j) => j.rate === null)).toBe(true);
  });

  it("--reps で同じ入力を複数回実行する", async () => {
    const api = fakeApi();
    const { env: e } = env(api, ["--yes", "--limit", "1", "--reps", "3", "--no-judge"]);
    const s = (await runDiagnosisEval(e)).summary!;
    expect(s.counts.planned).toBe(3);
    expect(api.stream).toHaveBeenCalledTimes(3);
  });
});

describe("採点者の自己点検", () => {
  it("空・的外れな文章に pass を付けなければ合格、付けたら要確認", async () => {
    const good = env(fakeApi({ judge: () => message(verdicts("fail"), {}, { input_tokens: 1, output_tokens: 1 }) }), ["--yes"]);
    expect((await runJudgeSelftest(good.env)).ok).toBe(true);
    const lenient = env(fakeApi({ judge: () => message(verdicts("pass")) }), ["--yes"]);
    expect((await runJudgeSelftest(lenient.env)).ok).toBe(false);
    expect(lenient.lines.join("\n")).toContain("想定外");
  });

  it("--yes なしでは API を呼ばない", async () => {
    const api = fakeApi();
    const { env: e } = env(api, []);
    await runJudgeSelftest(e);
    expect(api.stream).not.toHaveBeenCalled();
  });
});
