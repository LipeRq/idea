import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CaseTimeoutError, mapLimit, withDeadline } from "../../evals/lib/concurrency";
import { parseCommonOptions, selectCases } from "../../evals/lib/cli";
import { buildEstimate, captureRequest, CapturedRequest, countInputTokens, formatEstimate } from "../../evals/lib/estimate";
import { appendJsonl, createRunDir, runStamp } from "../../evals/lib/files";
import { CallRecorder, instrumentClient } from "../../evals/lib/instrument";
import { judgeSchema, summarizeVerdicts } from "../../evals/lib/judge";
import { PRICES_USD_PER_MTOK, priceFor } from "../../evals/lib/prices";
import { fmtRate, median, percentile, rateOf } from "../../evals/lib/stats";
import { costUsd, priceMessage } from "../../evals/lib/usage";
import type Anthropic from "@anthropic-ai/sdk";

describe("費用の計算(料金表の値から)", () => {
  it("料金表は Opus 5.5 が入力4・出力20・キャッシュ書き込み5・キャッシュ読み取り0.2 ドル/100万トークン", () => {
    expect(PRICES_USD_PER_MTOK["claude-opus-5-5"]).toEqual({ input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 });
  });

  it("4種類のトークンを、それぞれの単価で足す", () => {
    const usd = costUsd("claude-opus-5-5", { inputTokens: 10_000, outputTokens: 2_000, cacheCreationInputTokens: 1_000, cacheReadInputTokens: 5_000 });
    // 0.04 + 0.04 + 0.005 + 0.001
    expect(usd).toBeCloseTo(0.086, 9);
  });

  it("料金表にないモデルは Opus 5.5 の料金で概算し、assumed になる", () => {
    expect(priceFor("claude-unknown").assumed).toBe(true);
    expect(priceFor("claude-opus-5-5").assumed).toBe(false);
    expect(costUsd("claude-unknown", { inputTokens: 1_000_000, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 })).toBe(4);
  });

  it("フォールバックの応答は、試行ごとの内訳(usage.iterations)を、試行ごとのモデルの料金で足す", () => {
    const m = priceMessage("claude-opus-5-5", "claude-sonnet-5-5", {
      input_tokens: 999,
      output_tokens: 999,
      iterations: [
        { type: "message", input_tokens: 1_000_000, output_tokens: 0 },
        { type: "fallback_message", model: "claude-sonnet-5-5", input_tokens: 1_000_000, output_tokens: 1_000_000 },
      ],
    });
    expect(m.fallbackUsed).toBe(true);
    expect(m.usage.inputTokens).toBe(2_000_000);
    // opus 入力4 + sonnet 入力2 + sonnet 出力10(top-level の 999 は使わない)
    expect(m.costUsd).toBeCloseTo(16, 6);
  });

  it("内訳がなければ応答の usage を応答のモデルの料金で計算し、依頼と同じモデルなら fallbackUsed は false", () => {
    const m = priceMessage("claude-opus-5-5", "claude-opus-5-5", { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: null });
    expect(m.fallbackUsed).toBe(false);
    expect(m.costUsd).toBeCloseTo(0.006, 9);
  });
});

describe("集計", () => {
  it("Wilson 区間は、k=n でも 1 を超えず、n=0 は対象なし", () => {
    const r = rateOf(11, 11);
    expect(r.rate).toBe(1);
    expect(r.high).toBeLessThanOrEqual(1);
    expect(r.low).toBeGreaterThan(0.7);
    expect(rateOf(0, 0).rate).toBeNull();
    expect(fmtRate(rateOf(0, 0))).toContain("対象なし");
    expect(fmtRate(rateOf(3, 4))).toContain("3/4");
  });

  it("中央値とパーセンタイル", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(median([])).toBeNull();
  });

  it("採点者の集計は na を除いて割合を出す", () => {
    const criteria = [{ id: "a", text: "" }, { id: "b", text: "" }];
    const s = summarizeVerdicts(
      [
        [{ id: "a", verdict: "pass", evidence: "" }, { id: "b", verdict: "na", evidence: "" }],
        [{ id: "a", verdict: "fail", evidence: "" }, { id: "b", verdict: "na", evidence: "" }],
      ],
      criteria,
    );
    expect(s[0]).toMatchObject({ pass: 1, fail: 1, na: 0, rate: 0.5 });
    expect(s[1]).toMatchObject({ na: 2, rate: null });
    expect(judgeSchema(["a", "b"]).safeParse({ verdicts: [{ id: "c", verdict: "pass", evidence: "" }] }).success).toBe(false);
  });
});

describe("結果の保存", () => {
  it("日本時間の日時の名前で、同じ秒でも上書きしないディレクトリを作る", () => {
    expect(runStamp(new Date("2026-10-22T15:30:05Z"))).toBe("20261023-003005");
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "eval-files-"));
    const now = new Date("2026-10-22T00:00:00Z");
    const a = createRunDir(base, now);
    const b = createRunDir(base, now);
    expect(a).not.toBe(b);
    appendJsonl(a, "x.jsonl", { n: 1 });
    appendJsonl(a, "x.jsonl", { n: 2 });
    expect(fs.readFileSync(path.join(a, "x.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l).n)).toEqual([1, 2]);
  });
});

describe("コマンドライン", () => {
  it("既定値と、不正な値の拒否", () => {
    expect(parseCommonOptions([])).toMatchObject({ yes: false, limit: null, reps: 1, concurrency: 1, noJudge: false, only: null });
    expect(parseCommonOptions(["--yes", "--limit", "2", "--only", "a,b", "--no-judge"])).toMatchObject({ yes: true, limit: 2, only: ["a", "b"], noJudge: true });
    expect(() => parseCommonOptions(["--limit", "0"])).toThrow("1以上");
    expect(() => parseCommonOptions(["--unknown"])).toThrow();
  });

  it("--only の存在しない id は、使える id を示して失敗する", () => {
    const cases = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(selectCases(cases, { only: ["c", "a"], limit: null }).map((c) => c.id)).toEqual(["a", "c"]);
    expect(selectCases(cases, { only: null, limit: 2 }).map((c) => c.id)).toEqual(["a", "b"]);
    expect(() => selectCases(cases, { only: ["x"], limit: null })).toThrow("a, b, c");
  });
});

describe("同時実行と時間の上限", () => {
  it("同時に動く数を超えず、結果は元の順番", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60]);
    expect(peak).toBe(2);
  });

  it("上限を超えたら CaseTimeoutError にする", async () => {
    await expect(withDeadline(new Promise(() => {}), 20, "case-1")).rejects.toBeInstanceOf(CaseTimeoutError);
    await expect(withDeadline(Promise.resolve(1), 1000, "x")).resolves.toBe(1);
  });
});

function fakeAnthropic(handler: (params: Record<string, unknown>) => unknown, tokens = 1234) {
  const stream = vi.fn((params: Record<string, unknown>) => ({ finalMessage: async () => handler(params) }));
  const countTokens = vi.fn(async () => ({ input_tokens: tokens }));
  return { client: { beta: { messages: { stream, countTokens } } } as unknown as Anthropic, stream, countTokens };
}

describe("計測つきクライアント", () => {
  it("モデル・stop_reason・usage・費用・所要時間・依頼の内容を記録し、応答はそのまま返す", async () => {
    const message = { model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: "こんにちは" }], usage: { input_tokens: 1000, output_tokens: 200 } };
    const { client, stream } = fakeAnthropic(() => message);
    const recorder = new CallRecorder();
    const inst = instrumentClient(client, recorder, (p) => (p.max_tokens === 5 ? "x" : "y"));
    const got = await (inst.beta.messages as unknown as { stream: (p: unknown) => { finalMessage(): Promise<unknown> } }).stream({ model: "claude-opus-5-5", max_tokens: 5, system: "S", messages: [{ role: "user", content: "U" }], output_config: { effort: "medium" } }).finalMessage();
    expect(got).toBe(message);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(recorder.calls).toHaveLength(1);
    expect(recorder.calls[0]).toMatchObject({ label: "x", requestedModel: "claude-opus-5-5", servedModel: "claude-opus-5-5", stopReason: "end_turn", text: "こんにちは", effort: "medium", maxTokens: 5, fallbackUsed: false, error: null });
    expect(recorder.calls[0].costUsd).toBeCloseTo(0.008, 9);
    expect(recorder.totalCostUsd).toBeCloseTo(0.008, 9);
  });

  it("元のクライアントのメソッドを、this を保って呼ぶ(SDK のメソッドは this に依存する)", async () => {
    const messages = {
      tag: "real",
      stream(this: { tag: string }) {
        return { finalMessage: async () => ({ model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: this.tag }], usage: { input_tokens: 1, output_tokens: 1 } }) };
      },
    };
    const recorder = new CallRecorder();
    const inst = instrumentClient({ beta: { messages } } as unknown as Anthropic, recorder);
    await (inst.beta.messages as unknown as { stream: (p: unknown) => { finalMessage(): Promise<unknown> } }).stream({ model: "claude-opus-5-5" }).finalMessage();
    expect(recorder.calls[0].text).toBe("real");
  });

  it("失敗した呼び出しも、エラーつきで記録して投げ直す(費用は0)", async () => {
    const { client } = fakeAnthropic(() => {
      throw new Error("boom");
    });
    const recorder = new CallRecorder();
    const inst = instrumentClient(client, recorder);
    await expect((inst.beta.messages as unknown as { stream: (p: unknown) => { finalMessage(): Promise<unknown> } }).stream({ model: "m" }).finalMessage()).rejects.toThrow("boom");
    expect(recorder.calls[0]).toMatchObject({ error: "boom", costUsd: 0 });
  });
});

describe("費用見積もり", () => {
  it("取り出した依頼を count_tokens で数え、入力は実測・出力は想定で概算する。API は呼ばない", async () => {
    const { client, stream, countTokens } = fakeAnthropic(() => ({}), 10_000);
    const params = await captureRequest(async (c) => {
      await (c.beta.messages as unknown as { stream: (p: unknown) => { finalMessage(): Promise<unknown> } }).stream({ model: "claude-opus-5-5", max_tokens: 16_000, system: "S", messages: [{ role: "user", content: "U" }] }).finalMessage();
    });
    expect(params.max_tokens).toBe(16_000);
    const est = await buildEstimate(client, [{ caseId: "a", step: "生成", params, times: 2, assumedOutputTokens: 4_000 }]);
    expect(countTokens).toHaveBeenCalledTimes(1);
    expect(stream).not.toHaveBeenCalled();
    // (10,000×4 + 4,000×20) / 1e6 = 0.12 を2回
    expect(est.totals.expectedCostUsd).toBeCloseTo(0.24, 9);
    // 上限: (10,000×4 + 16,000×20) / 1e6 = 0.36 を2回
    expect(est.totals.maxCostUsd).toBeCloseTo(0.72, 9);
    expect(est.totals.calls).toBe(2);
    expect(formatEstimate(est)).toContain("$0.24");
  });

  it("API が呼ばれなかったときは、依頼を取り出せなかったと分かる", async () => {
    await expect(captureRequest(async () => undefined)).rejects.toThrow("取り出せませんでした");
    expect(new CapturedRequest({ model: "m", max_tokens: 1, messages: [] })).toBeInstanceOf(Error);
  });

  it("出力形式つきの計測が 400 で拒否されたら、形式を除いて数え直す。それ以外のエラーは投げる", async () => {
    const countTokens = vi.fn().mockRejectedValueOnce(Object.assign(new Error("invalid_request_error: output_config"), { status: 400 })).mockResolvedValueOnce({ input_tokens: 77 });
    const client = { beta: { messages: { countTokens } } } as unknown as Anthropic;
    expect(await countInputTokens(client, { model: "m", max_tokens: 1, messages: [], output_config: { effort: "medium" } })).toBe(77);
    expect(countTokens.mock.calls[1][0]).not.toHaveProperty("output_config");
    const down = { beta: { messages: { countTokens: vi.fn().mockRejectedValue(Object.assign(new Error("overloaded"), { status: 529 })) } } } as unknown as Anthropic;
    await expect(countInputTokens(down, { model: "m", max_tokens: 1, messages: [] })).rejects.toThrow("overloaded");
  });
});
