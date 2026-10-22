import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { calculateDiagnosis } from "@/lib/diagnosis/calculate";
import { buildFallbackReport } from "@/lib/diagnosis/fallback";
import { DIAGNOSIS_EVAL_CASES } from "./cases";
import { DIAGNOSIS_CRITERIA } from "./judge-criteria";
import { parseCommonOptions } from "./lib/cli";
import { runDiagnosisEval } from "./run";

// 本物の SDK(Anthropic クライアント)を使い、通信(fetch)だけを偽の応答にする。
// 計測つきクライアントが本物の SDK のストリーム・count_tokens を通しても動くこと(this の扱い、usage の読み取り、
// count_tokens に出力形式を渡せること)を確かめる。API には接続しない。

type Body = { system?: unknown; messages: { content: unknown }[]; output_config?: { format?: { schema?: unknown } } };

function sse(events: Record<string, unknown>[]): Response {
  const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function fakeFetchClient() {
  const seen: { url: string; body: Body }[] = [];
  const mfg = DIAGNOSIS_EVAL_CASES[0];
  const reportJson = JSON.stringify(buildFallbackReport(calculateDiagnosis(mfg.input)));
  const verdictsJson = JSON.stringify({ verdicts: DIAGNOSIS_CRITERIA.map((c) => ({ id: c.id, verdict: "pass", evidence: "x" })) });
  const client = new Anthropic({
    apiKey: "sk-ant-test",
    maxRetries: 0,
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body)) as Body;
      seen.push({ url, body });
      if (url.includes("count_tokens")) return Response.json({ input_tokens: 4321 });
      const judge = typeof body.system === "string" && body.system.includes("採点者");
      const text = judge ? verdictsJson : reportJson;
      return sse([
        { type: "message_start", message: { id: "msg_x", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: judge ? 1500 : 2000, output_tokens: 0 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: judge ? 300 : 1000 } },
        { type: "message_stop" },
      ]);
    },
  });
  return { client, seen };
}

describe("本物の SDK を通した評価(通信だけ偽物)", () => {
  it("見積もりは count_tokens に、アプリが送る system・messages・出力形式を渡し、生成(stream)は呼ばない", async () => {
    const { client, seen } = fakeFetchClient();
    const lines: string[] = [];
    const out = await runDiagnosisEval({ options: parseCommonOptions(["--only", "mfg-mid"]), client, log: (l) => lines.push(l) });
    expect(out.status).toBe("estimated");
    expect(seen.every((r) => r.url.includes("count_tokens"))).toBe(true);
    expect(seen).toHaveLength(2); // 生成と採点
    const gen = seen[0].body;
    expect(String(gen.system)).toContain("ITコンサルタント");
    expect(JSON.stringify(gen.messages)).toContain("製造業");
    expect(gen.output_config?.format?.schema).toBeTruthy();
    expect(lines.join("\n")).toContain("$");
  });

  it("--yes では、本物のストリームの応答から usage・モデル・所要時間を記録し、費用を計算する", async () => {
    const { client, seen } = fakeFetchClient();
    const out = await runDiagnosisEval({
      options: parseCommonOptions(["--yes", "--only", "mfg-mid"]),
      client,
      log: () => {},
      resultsBase: fs.mkdtempSync(path.join(os.tmpdir(), "eval-sdk-")),
    });
    const s = out.summary!;
    expect(s.counts).toEqual({ planned: 1, scored: 1, errors: 0 });
    expect(s.validation).toMatchObject({ k: 1, n: 1 });
    expect(s.hardPass).toMatchObject({ k: 1, n: 1 });
    expect(s.generateCost.totalUsd).toBeCloseTo((2000 * 4 + 1000 * 20) / 1_000_000, 9);
    expect(s.judgeCostUsd).toBeCloseTo((1500 * 4 + 300 * 20) / 1_000_000, 9);
    expect(s.fallbackUsed).toBe(0);
    expect(s.latencyMs.median).toBeGreaterThanOrEqual(0);
    // 本番と同じく、フォールバック(server-side-fallback)を付けて送っている
    expect(seen.filter((r) => !r.url.includes("count_tokens")).length).toBe(2);
  });
});
