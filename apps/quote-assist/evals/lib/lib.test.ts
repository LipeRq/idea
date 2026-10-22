import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { estimateCostUsd } from "@/lib/ai/client";
import { NO_KEY_MESSAGE, parseQuoteOptions, selectCases } from "./cli";
import { CaseTimeoutError, mapLimit, withDeadline } from "./concurrency";
import { buildEstimate, captureRequest, formatEstimate } from "./estimate";
import { appendJsonl, createRunDir, runStamp } from "./files";
import { PRICES_USD_PER_MTOK, priceFor } from "./prices";
import { fmtRate, median, percentile, rateOf } from "./stats";

describe("料金表", () => {
  it("アプリ本体(src/lib/ai/client.ts)の表と同じものを使い、画面の概算費用と食い違わない", () => {
    expect(PRICES_USD_PER_MTOK["claude-opus-5-5"]).toEqual({ input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 });
    expect(priceFor("unknown-model").assumed).toBe(true);
    const u = { inputTokens: 10_000, outputTokens: 2_000, cacheCreationInputTokens: 1_000, cacheReadInputTokens: 5_000 };
    expect(estimateCostUsd(u, "claude-opus-5-5")).toBeCloseTo(0.086, 9);
  });
});

describe("集計・保存・コマンドライン・同時実行", () => {
  it("Wilson 区間と中央値", () => {
    expect(rateOf(11, 11)).toMatchObject({ rate: 1, k: 11, n: 11 });
    expect(rateOf(0, 0).rate).toBeNull();
    expect(fmtRate(rateOf(3, 4))).toContain("3/4");
    expect(median([3, 1, 2])).toBe(2);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
  });

  it("日本時間の日時の名前で、同じ秒でも上書きしないディレクトリを作り、jsonl に追記する", () => {
    expect(runStamp(new Date("2026-10-22T15:30:05Z"))).toBe("20261023-003005");
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "eval-files-"));
    const now = new Date("2026-10-22T00:00:00Z");
    const a = createRunDir(base, now);
    expect(createRunDir(base, now)).not.toBe(a);
    appendJsonl(a, "x.jsonl", { n: 1 });
    appendJsonl(a, "x.jsonl", { n: 2 });
    expect(fs.readFileSync(path.join(a, "x.jsonl"), "utf8").trim().split("\n")).toHaveLength(2);
  });

  it("コマンドライン: 既定値・不正な値の拒否・--only の絞り込み", () => {
    expect(parseQuoteOptions([])).toMatchObject({ yes: false, demo: false, data: null, withEstimate: false, concurrency: 3, limit: null });
    expect(parseQuoteOptions(["--yes", "--data", "d", "--with-estimate", "--limit", "2"])).toMatchObject({ yes: true, data: "d", withEstimate: true, limit: 2 });
    expect(() => parseQuoteOptions(["--limit", "0"])).toThrow("1以上");
    const cases = [{ id: "a" }, { id: "b" }];
    expect(selectCases(cases, { only: ["b"], limit: null })).toEqual([{ id: "b" }]);
    expect(() => selectCases(cases, { only: ["z"], limit: null })).toThrow("a, b");
    expect(NO_KEY_MESSAGE).toContain("実行しません");
  });

  it("同時に動く数の制限と、1件の時間の上限", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return n;
    });
    expect(out).toEqual([1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
    await expect(withDeadline(new Promise(() => {}), 20, "case")).rejects.toBeInstanceOf(CaseTimeoutError);
  });
});

describe("費用見積もり", () => {
  it("取り出した依頼を count_tokens で数え、入力は実測・出力は想定で概算する。API は呼ばない", async () => {
    const stream = vi.fn();
    const countTokens = vi.fn(async () => ({ input_tokens: 10_000 }));
    const client = { beta: { messages: { stream, countTokens } } } as unknown as Anthropic;
    const params = await captureRequest(async (c) => {
      await (c.beta.messages as unknown as { stream: (p: unknown) => { finalMessage(): Promise<unknown> } }).stream({ model: "claude-opus-5-5", max_tokens: 32_000, messages: [] }).finalMessage();
    });
    const est = await buildEstimate(client, [{ caseId: "a", step: "読み取り", params, times: 1, assumedOutputTokens: 3_500 }]);
    expect(stream).not.toHaveBeenCalled();
    expect(est.totals.expectedCostUsd).toBeCloseTo((10_000 * 4 + 3_500 * 20) / 1_000_000, 9);
    expect(est.totals.maxCostUsd).toBeCloseTo((10_000 * 4 + 32_000 * 20) / 1_000_000, 9);
    expect(formatEstimate(est)).toContain("概算費用");
  });
});
