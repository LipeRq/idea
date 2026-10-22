import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { estimateCostUsd } from "@/lib/ai/client";
import { DEMO_SCENARIOS } from "@/lib/demo/scenarios";
import { loadReferenceData, type ReferenceData } from "@/lib/reference/load";
import { DATA_DIR, SAMPLES_DIR, TEST_TODAY } from "@/lib/test-helpers";
import { exportDemoDataset } from "./demo-dataset";
import { parseQuoteOptions } from "./lib/cli";
import { runQuoteEval } from "./run";

// 実際のAPIは呼ばない。アプリ本体が使う client.beta.messages.stream だけを差し替える(費用の見積もり用の count_tokens は、env.client の偽物)
const { streamMock } = vi.hoisted(() => ({ streamMock: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    beta = { messages: { stream: streamMock } };
  },
}));

let ref: ReferenceData;
beforeAll(async () => {
  ref = await loadReferenceData(DATA_DIR);
});

const USAGE = { input_tokens: 12_000, output_tokens: 3_000, cache_creation_input_tokens: 900, cache_read_input_tokens: 4_000 };
const text = (t: string) => ({ type: "text", text: t, citations: null });

/** 依頼に書かれた図面のファイル名から、どのデモの引き合いかを選び、その固定結果(正解ラベルどおり)を返す */
function respondByScenario(over: Record<string, unknown> = {}) {
  streamMock.mockImplementation((params: { messages: { content: { type: string; text?: string }[] }[]; output_config: { format: { schema: { properties?: Record<string, unknown> } } } }) => ({
    finalMessage: async () => {
      const prompt = params.messages[0].content.map((b) => b.text ?? "").join("\n");
      const isExtraction = Boolean(params.output_config.format.schema.properties?.partName);
      if (!isExtraction) {
        // 工数案の依頼: 解析できない出力にして、アプリ本体の「標準の工数案に切り替える」動きを通す
        return { content: [text("not json")], stop_reason: "end_turn", model: "claude-opus-5-5", usage: USAGE };
      }
      const s = DEMO_SCENARIOS.find((x) => x.drawings.some((d) => prompt.includes(d.fileName)))!;
      const today = TEST_TODAY;
      const out = s.buildExtraction({ emailBody: s.buildEmail(today).body, today });
      return { content: [text(JSON.stringify(out))], stop_reason: "end_turn", model: "claude-opus-5-5", usage: USAGE, ...over };
    },
  }));
}

const fakeCountClient = () => {
  const countTokens = vi.fn(async () => ({ input_tokens: 20_000 }));
  return { client: { beta: { messages: { countTokens } } } as unknown as Anthropic, countTokens };
};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "eval-quote-"));
const NOW = new Date("2026-10-19T01:00:00Z");

function setup(args: string[], count = fakeCountClient()) {
  const lines: string[] = [];
  const base = tmp();
  return {
    env: { options: parseQuoteOptions(args), client: count.client, log: (l: string) => lines.push(l), resultsBase: base, now: () => NOW, loadReference: async () => ref, samplesDir: SAMPLES_DIR },
    lines,
    base,
    count,
  };
}

beforeEach(() => streamMock.mockReset());

describe("見積アシストの評価の実行", () => {
  it("--yes なしでは、アプリが実際に送る依頼(図面PDFつき)を count_tokens で数えて概算費用を表示するだけで、API は呼ばず、ファイルも作らない", async () => {
    respondByScenario();
    const { env, lines, base, count } = setup([]);
    const out = await runQuoteEval(env);
    expect(out.status).toBe("estimated");
    expect(streamMock).not.toHaveBeenCalled();
    expect(count.countTokens).toHaveBeenCalledTimes(3);
    // 実際に送る依頼には、図面のPDF(document ブロック)が入っている
    const sent = count.countTokens.mock.calls[0] as unknown as [{ messages: { content: { type: string }[] }[] }];
    expect(sent[0].messages[0].content.filter((b) => b.type === "document")).toHaveLength(2);
    expect(lines.join("\n")).toContain("概算費用");
    expect(lines.join("\n")).toContain("--yes");
    expect(fs.readdirSync(base)).toEqual([]);
    // 入力 20,000 / 出力 3,500(想定): (20000×4 + 3500×20)/1e6 × 3件
    expect(out.estimateUsd).toBeCloseTo((3 * (80_000 + 70_000)) / 1_000_000, 9);
  });

  it("--with-estimate では工数案の依頼も数える", async () => {
    respondByScenario();
    const { env, count } = setup(["--with-estimate", "--only", "revision"]);
    await runQuoteEval(env);
    expect(count.countTokens).toHaveBeenCalledTimes(2);
  });

  it("--yes で実行すると、本番と同じ入口で読み取り、正解と照合し、費用・時間・トークンを usage から計算して保存する", async () => {
    respondByScenario();
    const { env } = setup(["--yes", "--concurrency", "1"]);
    const out = await runQuoteEval(env);
    expect(out.status).toBe("done");
    const s = out.summary!;
    expect(s.mode).toBe("anthropic");
    expect(s.counts).toEqual({ planned: 3, scored: 3, errors: 0 });
    expect(s.aggregate.overall).toMatchObject({ k: 27, n: 27 });
    expect(s.aggregate.confidentErrors).toEqual([]);
    expect(s.aggregate.questions.recall).toMatchObject({ k: 7, n: 7 });
    // 読み取り1回あたり: 入力12,000・出力3,000・キャッシュ書き込み900・キャッシュ読み取り4,000
    const per = estimateCostUsd({ inputTokens: 12_000, outputTokens: 3_000, cacheCreationInputTokens: 900, cacheReadInputTokens: 4_000 }, "claude-opus-5-5");
    expect(per).toBeCloseTo((12_000 * 4 + 3_000 * 20 + 900 * 5 + 4_000 * 0.2) / 1_000_000, 9);
    expect(s.cost.totalUsd).toBeCloseTo(per * 3, 6);
    expect(s.tokens).toEqual({ input: 36_000, output: 9_000, cache: 14_700 });
    expect(streamMock).toHaveBeenCalledTimes(3);
    const dir = out.dir!;
    expect(fs.readFileSync(path.join(dir, "results.jsonl"), "utf8").trim().split("\n")).toHaveLength(3);
    const json = JSON.parse(fs.readFileSync(path.join(dir, "results.json"), "utf8"));
    expect(json.summary.cost.totalUsd).toBeCloseTo(per * 3, 6);
    const md = fs.readFileSync(path.join(dir, "summary.md"), "utf8");
    expect(md).toContain("自信のある誤り");
    expect(md).toContain("不要な確認事項");
    expect(md).toContain("類似検索の的中率");
    // 結果にお客様のデータ(メール本文・図面)は入れない
    expect(JSON.stringify(json)).not.toContain("お世話になっております");
  });

  it("読み取りが間違っていて確からしさが「高」なら、自信のある誤りとして一覧に出る", async () => {
    // 材質を誤った固定結果にする(確からしさは「高」のまま)
    streamMock.mockImplementation(() => ({
      finalMessage: async () => {
        const s = DEMO_SCENARIOS[0];
        const out = s.buildExtraction({ emailBody: s.buildEmail(TEST_TODAY).body, today: TEST_TODAY });
        out.material = { ...out.material, value: "SS400", confidence: "high" };
        return { content: [text(JSON.stringify(out))], stop_reason: "end_turn", model: "claude-opus-5-5", usage: USAGE };
      },
    }));
    const { env } = setup(["--yes", "--only", "revision"]);
    const s = (await runQuoteEval(env)).summary!;
    expect(s.aggregate.confidentErrors).toEqual([{ caseId: "revision", key: "material", expected: "SUS304", actual: "SS400" }]);
  });

  it("AIの読み取りが失敗した件は errors.jsonl に分け、スコアには数えない", async () => {
    streamMock.mockImplementation(() => ({ finalMessage: async () => Promise.reject(new Error("connection reset")) }));
    const { env } = setup(["--yes", "--only", "revision"]);
    const out = await runQuoteEval(env);
    expect(out.summary!.counts).toEqual({ planned: 1, scored: 0, errors: 1 });
    expect(out.summary!.failureClasses).toEqual({ extract_failed: 1 });
    expect(fs.readFileSync(path.join(out.dir!, "errors.jsonl"), "utf8")).toContain("extract_failed");
  });

  it("フォールバックで別のモデルが応答した件を数える", async () => {
    respondByScenario({ model: "claude-opus-5" });
    const { env } = setup(["--yes", "--only", "revision"]);
    expect((await runQuoteEval(env)).summary!.fallbackUsed).toBe(1);
  });

  it("--with-estimate は、画面に出る上位5件(AIの並べ替え後)でも類似検索を採点する", async () => {
    respondByScenario();
    const { env } = setup(["--yes", "--with-estimate", "--only", "revision"]);
    const s = (await runQuoteEval(env)).summary!;
    expect(s.withEstimate).toBe(true);
    expect(s.aggregate.similar.map((m) => m.mode)).toEqual(["rule_extracted", "rule_truth", "ai_rerank"]);
    expect(s.steps.map((x) => x.step)).toContain("estimate");
    // 読み取りと工数案の2回
    expect(streamMock).toHaveBeenCalledTimes(2);
  });

  it("--demo は API も count_tokens も使わず、固定結果で仕組みを確かめる(精度100%)", async () => {
    const { env } = setup(["--demo"]);
    const out = await runQuoteEval({ ...env, client: null });
    expect(streamMock).not.toHaveBeenCalled();
    expect(out.summary!.mode).toBe("demo");
    expect(out.summary!.aggregate.overall.rate).toBe(1);
    expect(out.summary!.cost.totalUsd).toBe(0);
  });

  it("PoC のデータ(--data)を読み込んで評価する。デモを書き出した形式なら --demo で精度100%", async () => {
    const dir = tmp();
    exportDemoDataset(dir, ref, SAMPLES_DIR, TEST_TODAY);
    const { env } = setup(["--demo", "--data", dir, "--only", "revision,short-lead"]);
    const out = await runQuoteEval({ ...env, client: null });
    expect(out.summary!.source).toContain(dir);
    expect(out.summary!.counts.scored).toBe(2);
    expect(out.summary!.aggregate.overall.rate).toBe(1);
    // 参考にする過去案件(台帳の旧版)が上位5件に入る
    expect(out.summary!.aggregate.similar[0].hitAny.rate).toBe(1);
  });

  it("--export-demo はデモ用の3件を PoC の形式で書き出し、API は使わない", async () => {
    const dir = path.join(tmp(), "sample");
    const { env, lines } = setup(["--export-demo", dir]);
    const out = await runQuoteEval({ ...env, client: null });
    expect(out.status).toBe("exported");
    expect(fs.existsSync(path.join(dir, "cases.csv"))).toBe(true);
    expect(lines.join("\n")).toContain("3 件");
  });
});
