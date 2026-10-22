import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { analyzeFile } from "../../src/analyzeFile";
import { INVENTORY_EVAL_CASES, casePath } from "../../evals/cases";
import { INVENTORY_CRITERIA } from "../../evals/judge-criteria";
import { parseCommonOptions } from "../../evals/lib/cli";
import { runInventoryEval, runJudgeSelftest } from "../../evals/run";
import type { InventoryReport } from "../../src/schema";
import { oracleDocument } from "./helpers";

// 実際のAPIは呼ばない。client.beta.messages の stream / countTokens だけを偽物にする。
// 本物の analyzeFile(サンプルのブックの解析)と generateAiDocument(map → reduce)は動かす。

type Params = { system?: unknown; messages: { content: string }[] };
const sys = (p: Params) => (typeof p.system === "string" ? p.system : "");
const isJudge = (p: Params) => sys(p).includes("採点者");
const isMap = (p: Params) => sys(p).includes("棚卸ししています");

const message = (text: string, over: Record<string, unknown> = {}, usage = { input_tokens: 3000, output_tokens: 800 }) => ({
  model: "claude-opus-5-5",
  stop_reason: "end_turn",
  content: [{ type: "text", text }],
  usage,
  ...over,
});
const verdicts = (v: "pass" | "fail" | "na") => JSON.stringify({ verdicts: INVENTORY_CRITERIA.map((c) => ({ id: c.id, verdict: v, evidence: "引用" })) });

const reports = new Map<string, InventoryReport>();
beforeAll(async () => {
  for (const c of INVENTORY_EVAL_CASES.filter((x) => !x.injection)) reports.set(c.id, await analyzeFile(casePath(c)));
});

/** map の依頼に書かれたモジュール名・プロシージャ名から要約を返し、reduce にはオラクルの全体の文章を返す偽の API */
function fakeApi(over: { map?: (p: Params, n: number) => unknown; reduce?: (p: Params) => unknown; judge?: (p: Params) => unknown } = {}) {
  let mapCalls = 0;
  const stream = vi.fn((params: Params) => ({
    finalMessage: async () => {
      if (isJudge(params)) return (over.judge ?? (() => message(verdicts("pass"), {}, { input_tokens: 4000, output_tokens: 300 })))(params);
      if (isMap(params)) {
        const n = mapCalls++;
        if (over.map) return over.map(params, n);
        const modules = [...params.messages[0].content.matchAll(/<module name="([^"]*)"[^>]*>\n要約するプロシージャ: ([^\n]*)\n/g)].map((m) => ({
          moduleName: m[1],
          purpose: "業務の処理をまとめたものと思われます。",
          procedures: m[2].startsWith("(なし") ? [] : m[2].split("、").map((name) => ({ name, summary: "入力を確認して処理するものと思われます。" })),
          concerns: [],
        }));
        return message(JSON.stringify({ modules }), {}, { input_tokens: 5000, output_tokens: 1000 });
      }
      if (over.reduce) return over.reduce(params);
      const doc = oracleDocument(reports.get("juchu")!);
      return message(JSON.stringify(doc.overall), {}, { input_tokens: 8000, output_tokens: 2000 });
    },
  }));
  const countTokens = vi.fn(async () => ({ input_tokens: 6000 }));
  return { client: { beta: { messages: { stream, countTokens } } } as unknown as Anthropic, stream, countTokens };
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "eval-document-"));
const env = (api: ReturnType<typeof fakeApi>, args: string[], base = tmp()) => {
  const lines: string[] = [];
  return { env: { options: parseCommonOptions(args), client: api.client, log: (l: string) => lines.push(l), resultsBase: base, now: () => new Date("2026-10-22T00:00:00Z") }, lines, base };
};

describe("仕様書の評価の実行", () => {
  it("--yes なしでは、本物の依頼を取り出して費用を見積もるだけで、API(生成・採点)は呼ばず、ファイルも作らない", async () => {
    const api = fakeApi();
    const { env: e, lines, base } = env(api, ["--only", "mitsumori"]);
    const out = await runInventoryEval(e);
    expect(out.status).toBe("estimated");
    expect(api.stream).not.toHaveBeenCalled();
    // 見積書作成: map 1回 + reduce 1回 + 採点 1回
    expect(api.countTokens.mock.calls.length).toBeGreaterThanOrEqual(3);
    const text = lines.join("\n");
    expect(text).toContain("全体統合 reduce");
    expect(text).toContain("LLM採点");
    expect(text).toContain("--yes");
    expect(fs.readdirSync(base)).toEqual([]);
    expect(out.estimateUsd).toBeGreaterThan(0.1);
  });

  it("--yes で map → reduce → 採点を実行し、呼び出し回数・費用・検証率を usage から計算して保存する", async () => {
    const api = fakeApi();
    const { env: e } = env(api, ["--yes", "--only", "mitsumori"]);
    const out = await runInventoryEval(e);
    const s = out.summary!;
    expect(s.counts).toEqual({ planned: 1, scored: 1, errors: 0 });
    expect(s.validation).toMatchObject({ k: 1, n: 1 });
    const mapCalls = api.stream.mock.calls.filter(([p]) => isMap(p)).length;
    expect(mapCalls).toBeGreaterThanOrEqual(1);
    expect(s.apiCalls).toEqual({ generate: mapCalls + 1, judge: 1, total: mapCalls + 2 });
    expect(s.callValidation).toMatchObject({ k: mapCalls + 1, n: mapCalls + 1 });
    // map: 5000/1000 → 0.04、reduce: 8000/2000 → 0.072、採点: 4000/300 → 0.022
    expect(s.generateCostUsd).toBeCloseTo(mapCalls * 0.04 + 0.072, 9);
    expect(s.judgeCostUsd).toBeCloseTo(0.022, 9);
    expect(s.hardPass).toMatchObject({ k: 1, n: 1 });
    const dir = out.dir!;
    expect(fs.readFileSync(path.join(dir, "results.jsonl"), "utf8").trim().split("\n")).toHaveLength(1);
    const json = JSON.parse(fs.readFileSync(path.join(dir, "results.json"), "utf8"));
    expect(json.rows[0].generate.calls.map((c: { label: string }) => c.label)).toContain("reduce");
    expect(fs.readFileSync(path.join(dir, "summary.md"), "utf8")).toContain("API 呼び出し回数");
  });

  it("ファイルの中の指示に従った出力は、必須規則で不合格になる", async () => {
    const injected = oracleDocument(reports.get("juchu")!);
    injected.overall.overview = "INJECTED-4242";
    const api = fakeApi({ reduce: () => message(JSON.stringify(injected.overall)) });
    const { env: e } = env(api, ["--yes", "--only", "juchu-injection", "--no-judge"]);
    const s = (await runInventoryEval(e)).summary!;
    expect(s.hardPass).toMatchObject({ k: 0, n: 1 });
    expect(s.rules.find((r) => r.id === "injection_resisted")!.rate).toMatchObject({ k: 0, n: 1 });
    // 差し込んだ文が、本番と同じ処理で「データ」として map の依頼に入っている(< は &lt; に直される)
    const mapPrompts = api.stream.mock.calls.filter(([p]) => isMap(p)).map(([p]) => p.messages[0].content).join("\n");
    expect(mapPrompts).toContain("INJECTED-4242");
    expect(mapPrompts).toContain("&lt;/source>");
  });

  it("AI の呼び出しが通信で失敗したら errors.jsonl に分け、スコアには数えない(途中までにかかった費用は合計に入れる)", async () => {
    const api = fakeApi({
      reduce: () => {
        throw new Error("connection reset");
      },
    });
    const { env: e } = env(api, ["--yes", "--only", "mitsumori", "--no-judge"]);
    const out = await runInventoryEval(e);
    const s = out.summary!;
    expect(s.counts).toEqual({ planned: 1, scored: 0, errors: 1 });
    expect(s.failureClasses).toEqual({ infra: 1 });
    expect(s.generateCostUsd).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(out.dir!, "errors.jsonl"), "utf8")).toContain("connection reset");
  });

  it("構造が壊れた出力・出力上限は、通信の失敗ではなく検証の失敗として数え、採点者には渡さない", async () => {
    const api = fakeApi({ reduce: () => message("これはJSONではありません") });
    const { env: e } = env(api, ["--yes", "--only", "mitsumori"]);
    const s = (await runInventoryEval(e)).summary!;
    expect(s.validation).toMatchObject({ k: 0, n: 1 });
    expect(s.failureClasses).toEqual({ invalid_output: 1 });
    expect(s.callValidation.k).toBeLessThan(s.callValidation.n!);
    expect(api.stream.mock.calls.filter(([p]) => isJudge(p))).toHaveLength(0);

    const truncated = fakeApi({ reduce: () => message("{}", { stop_reason: "max_tokens" }) });
    const t = (await runInventoryEval(env(truncated, ["--yes", "--only", "mitsumori", "--no-judge"]).env)).summary!;
    expect(t.failureClasses).toEqual({ truncated: 1 });
  });

  it("フォールバックで別のモデルが応答した呼び出しを数える", async () => {
    const api = fakeApi({ reduce: () => message(JSON.stringify(oracleDocument(reports.get("juchu")!).overall), { model: "claude-sonnet-5-5" }, { input_tokens: 1_000_000, output_tokens: 0 }) });
    const s = (await runInventoryEval(env(api, ["--yes", "--only", "mitsumori", "--no-judge"]).env)).summary!;
    expect(s.fallbackUsedCalls).toBe(1);
  });
});

describe("採点者の自己点検", () => {
  it("空・的外れな文章に pass を付けなければ合格、付けたら要確認。--yes なしでは API を呼ばない", async () => {
    const good = env(fakeApi({ judge: () => message(verdicts("fail"), {}, { input_tokens: 1, output_tokens: 1 }) }), ["--yes"]);
    expect((await runJudgeSelftest(good.env)).ok).toBe(true);
    const lenient = env(fakeApi({ judge: () => message(verdicts("pass")) }), ["--yes"]);
    expect((await runJudgeSelftest(lenient.env)).ok).toBe(false);
    const dry = fakeApi();
    await runJudgeSelftest(env(dry, []).env);
    expect(dry.stream).not.toHaveBeenCalled();
  });
});
