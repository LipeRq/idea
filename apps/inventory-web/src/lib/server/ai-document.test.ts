import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeBuffer, type InventoryReport } from "@engine/browser";
import type { StructuredClient } from "@engine/doc/ai";
import { CONSENT_VERSION } from "@/lib/ai-consent";
import { AiDocumentJsonSchema } from "@/lib/ai-json-schema";
import { MARKER, secretWorkbook } from "@/test/fixtures";
import { buildAiPayload } from "@/worker/handle";
import { aiConfigFromEnv, aiStatusBody } from "./ai-config";
import { handleAiDocumentPost, type AiRouteDeps } from "./ai-document";
import { resetAiQuotaForTest } from "./ai-quota";
import { createMockClient, MOCK_MARK } from "./mock-client";
import { resetRateLimitForTest } from "./rate-limit";

const ACCESS_CODE = "コード-123";
const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;
const BASE_ENV: Record<string, string> = {
  INVENTORY_AI_MODE: "mock",
  INVENTORY_AI_ACCESS_CODE: ACCESS_CODE,
  INVENTORY_AI_MOCK_DELAY_MS: "0",
  INVENTORY_AI_PER_HOUR: "100",
  INVENTORY_AI_DAILY_LIMIT: "100",
};

const report: InventoryReport = analyzeBuffer(secretWorkbook(), "顧客台帳.xlsm", { now: new Date("2026-10-20T00:00:00Z") });
const validBody = buildAiPayload(report, true, CONSENT_VERSION).body;

function post(body: string, headers: Record<string, string> = {}, signal?: AbortSignal) {
  return new Request("http://localhost/api/ai-document", {
    method: "POST",
    headers: { "content-type": "application/json", "x-access-code": encodeURIComponent(ACCESS_CODE), "x-forwarded-for": "203.0.113.5", ...headers },
    body,
    signal,
  });
}

async function events(res: Response) {
  return (await res.text())
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { type: string; [k: string]: unknown });
}

const logs: string[] = [];
beforeEach(() => {
  resetRateLimitForTest();
  resetAiQuotaForTest();
  for (const level of ["info", "warn", "error", "log"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
  }
});
afterEach(() => {
  vi.restoreAllMocks();
});

const call = (req: Request, extra: Record<string, string> = {}, deps: AiRouteDeps = {}) =>
  handleAiDocumentPost(req, { env: env({ ...BASE_ENV, ...extra }), ...deps });

describe("POST /api/ai-document の受付順", () => {
  it("無効なら 503", async () => {
    const res = await call(post(validBody), { INVENTORY_AI_MODE: "off" });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "disabled" });
  });

  it("アクセスコードが違う・無いと 403", async () => {
    expect((await call(post(validBody, { "x-access-code": "wrong" }))).status).toBe(403);
    const req = post(validBody);
    req.headers.delete("x-access-code");
    expect((await call(req)).status).toBe(403);
  });

  it("送信元ごとの回数を超えると 429", async () => {
    const limit = { INVENTORY_AI_PER_HOUR: "1" };
    await events(await call(post(validBody), limit));
    const res = await call(post(validBody), limit);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "rate_limited" });
  });

  it("Content-Type が JSON でないと 415、本文が大きすぎると 413", async () => {
    expect((await call(post(validBody, { "content-type": "text/plain" }))).status).toBe(415);
    const res = await call(post(validBody), { INVENTORY_AI_MAX_BODY_BYTES: "100" });
    expect(res.status).toBe(413);
  });

  it("JSON でない・同意の版が違う・抽出結果の形が違うと拒否する", async () => {
    expect((await call(post("{not json"))).status).toBe(400);
    const outdated = await call(post(JSON.stringify({ consentVersion: "1999-01-01", report })));
    expect(outdated.status).toBe(409);
    expect(await outdated.json()).toMatchObject({ code: "consent_outdated" });
    expect((await call(post(JSON.stringify({ consentVersion: CONSENT_VERSION, report: { file: {} } })))).status).toBe(400);
  });

  it("依頼が大きすぎる(推定トークン・要約の回数)と 413", async () => {
    expect((await call(post(validBody), { INVENTORY_AI_MAX_INPUT_TOKENS: "10" })).status).toBe(413);
    expect((await call(post(validBody), { INVENTORY_AI_MAX_BATCHES: "0" })).status).toBe(413);
  });

  it("1日の上限を超えると 429(失敗した依頼も数える)", async () => {
    const limit = { INVENTORY_AI_DAILY_LIMIT: "1" };
    const failing: AiRouteDeps = { createClient: () => ({ generate: () => Promise.reject(new Error("x")) }) };
    await events(await call(post(validBody), limit, failing));
    const res = await call(post(validBody), limit);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "daily_limit" });
  });
});

describe("生成", () => {
  it("mock では accepted → progress → done を NDJSON で返し、done は画面のスキーマを通る", async () => {
    const res = await call(post(validBody));
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const list = await events(res);
    expect(list[0]).toMatchObject({ type: "accepted" });
    expect(list.some((e) => e.type === "progress")).toBe(true);
    const done = list.at(-1)!;
    expect(done.type).toBe("done");
    const ai = AiDocumentJsonSchema.parse(done.ai);
    expect(ai.overall.overview).toContain(MOCK_MARK);
    expect(Object.keys(ai.modules)).toContain("通知連携");
  });

  it("サーバーでも作成者・ファイル名などを外し直してから AI に渡す", async () => {
    const prompts: string[] = [];
    const recording: AiRouteDeps = {
      createClient: (config, signal) => {
        const mock = createMockClient(0, signal);
        return {
          generate(req) {
            prompts.push(req.system, req.user);
            return mock.generate(req);
          },
        } as StructuredClient;
      },
    };
    // 画面の送信内容を経ずに、作成者名などが入ったままの抽出結果を送る
    await events(await call(post(JSON.stringify({ consentVersion: CONSENT_VERSION, report })), {}, recording));
    const text = prompts.join("\n");
    expect(text).toContain(MARKER.source);
    for (const word of [report.properties.creator!, report.properties.lastModifiedBy!, "顧客台帳", report.file.sha256]) {
      expect(text).not.toContain(word);
    }
  });

  it("AI の失敗は error イベントで返し、想定外の例外のメッセージは画面に出さない", async () => {
    const list = await events(
      await call(post(validBody), {}, { createClient: () => ({ generate: () => Promise.reject(new Error(`内部の詳細 ${MARKER.source}`)) }) }),
    );
    const error = list.at(-1)!;
    expect(error.type).toBe("error");
    expect(String(error.message)).not.toContain(MARKER.source);
  });

  it("中止されたら、新しい依頼を出さない", async () => {
    const abort = new AbortController();
    let calls = 0;
    const deps: AiRouteDeps = {
      createClient: (config, signal) => {
        const mock = createMockClient(0, signal);
        return {
          async generate(req) {
            calls++;
            abort.abort();
            return mock.generate(req);
          },
        } as StructuredClient;
      },
    };
    const res = await call(post(validBody, {}, abort.signal), {}, deps);
    await res.text().catch(() => "");
    expect(calls).toBe(1);
  });

  it("無通信で切られないよう heartbeat を送る", async () => {
    const slow: AiRouteDeps = { heartbeatMs: 5, createClient: (_c, signal) => createMockClient(40, signal) };
    const list = await events(await call(post(validBody), {}, slow));
    expect(list.some((e) => e.type === "heartbeat")).toBe(true);
    expect(list.at(-1)?.type).toBe("done");
  });
});

describe("ログ", () => {
  it("件数だけの1行ログで、ソース・ファイル名・モジュール名・パスワード・アクセスコードを出さない", async () => {
    await events(await call(post(validBody)));
    await call(post(validBody, { "x-access-code": "wrong" }));
    const all = logs.join("\n");
    expect(all).toContain('"event":"ai_document"');
    expect(all).toContain('"outcome":"ok"');
    for (const word of [MARKER.source, MARKER.password, MARKER.apiKey, MARKER.email, "顧客台帳", "通知連携", ACCESS_CODE, "203.0.113.5"]) {
      expect(all, word).not.toContain(word);
    }
  });
});

describe("設定(費用の歯止め)", () => {
  it("claude モードは APIキーとアクセスコードがそろったときだけ有効(匿名公開は明示したときだけ)", () => {
    const base = { INVENTORY_AI_MODE: "claude" };
    expect(aiConfigFromEnv(env(base)).reason).toBe("no_credentials");
    expect(aiConfigFromEnv(env({ ...base, ANTHROPIC_API_KEY: "k" })).reason).toBe("no_access_code");
    expect(aiConfigFromEnv(env({ ...base, ANTHROPIC_API_KEY: "k", INVENTORY_AI_ACCESS_CODE: "c" })).available).toBe(true);
    expect(aiConfigFromEnv(env({ ...base, ANTHROPIC_API_KEY: "k", INVENTORY_AI_ALLOW_ANONYMOUS: "true" })).available).toBe(true);
  });

  it("Vercel 上で共有ストアが無いと使わない。読み取れない上限・0 は止める", () => {
    const vercel = { INVENTORY_AI_MODE: "mock", VERCEL: "1" };
    expect(aiConfigFromEnv(env(vercel)).available).toBe(true); // mock は費用がかからない
    expect(aiConfigFromEnv(env({ ...vercel, INVENTORY_AI_MODE: "claude", ANTHROPIC_API_KEY: "k", INVENTORY_AI_ACCESS_CODE: "c" })).reason).toBe("no_shared_store");
    expect(aiConfigFromEnv(env({ INVENTORY_AI_MODE: "mock", INVENTORY_AI_DAILY_LIMIT: "abc" })).reason).toBe("stopped");
    expect(aiConfigFromEnv(env({ INVENTORY_AI_MODE: "mock", INVENTORY_AI_DAILY_LIMIT: "0" })).reason).toBe("stopped");
    expect(aiConfigFromEnv(env({ INVENTORY_AI_MODE: "chatgpt" })).reason).toBe("invalid_mode");
  });

  it("GET の応答に秘密を含めない", () => {
    const body = aiStatusBody(aiConfigFromEnv(env({ ...BASE_ENV, ANTHROPIC_API_KEY: "sk-secret" })));
    expect(JSON.stringify(body)).not.toMatch(/sk-secret|コード-123/);
    expect(body).toMatchObject({ available: true, mode: "mock", requiresAccessCode: true, consentVersion: CONSENT_VERSION });
  });
});
