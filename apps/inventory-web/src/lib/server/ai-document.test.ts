import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeBuffer, type InventoryReport } from "@engine/browser";
import { ClaudeSdk, type StructuredClient } from "@engine/doc/ai";
import { hashClientKey } from "@idea/shared/rate-limit";
import { CONSENT_VERSION } from "@/lib/ai-consent";
import { AiDocumentJsonSchema } from "@/lib/ai-json-schema";
import { MARKER, secretWorkbook } from "@/test/fixtures";
import { buildAiPayload } from "@/worker/handle";
import { aiConfigFromEnv, aiStatusBody, resetAiConfigWarningsForTest } from "./ai-config";
import { handleAiDocumentPost, type AiRouteDeps } from "./ai-document";
import { resetAccessGuardForTest } from "./access-guard";
import { resetAiQuotaForTest } from "./ai-quota";
import { clientKey } from "./http";
import { KV_KEY_PREFIX } from "./kv";
import { createMockClient, MOCK_MARK } from "./mock-client";
import { resetRateLimitForTest } from "./rate-limit";

const ACCESS_CODE = "テスト用のアクセスコード-0123456789";
const PRIVACY_URL = "https://example.com/privacy";
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
  resetAccessGuardForTest();
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

  it("誤ったアクセスコードの試行が続くと、その送信元は正しいコードでも 429(総当たり対策)", async () => {
    const vercel = { VERCEL: "1", INVENTORY_AI_ACCESS_FAILURES_PER_HOUR: "3" };
    const from = (ip: string, code: string) => post(validBody, { "x-vercel-forwarded-for": ip, "x-access-code": encodeURIComponent(code) });
    for (let i = 0; i < 3; i++) expect((await call(from("198.51.100.1", "wrong"), vercel)).status).toBe(403);
    const locked = await call(from("198.51.100.1", ACCESS_CODE), vercel);
    expect(locked.status).toBe(429);
    expect(await locked.json()).toMatchObject({ code: "access_locked" });
    // 別の送信元は受け付ける
    expect((await call(from("198.51.100.2", ACCESS_CODE), vercel)).status).toBe(200);
  });

  it("サイト全体の誤ったコードの試行が上限に達すると、どの送信元も 429", async () => {
    const env = { VERCEL: "1", INVENTORY_AI_ACCESS_FAILURES_SITE_PER_HOUR: "4" };
    for (let i = 0; i < 4; i++) {
      await call(post(validBody, { "x-vercel-forwarded-for": `192.0.2.${i}`, "x-access-code": "wrong" }), env);
    }
    expect((await call(post(validBody, { "x-vercel-forwarded-for": "192.0.2.99" }), env)).status).toBe(429);
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

  it("全体の時間上限(外から渡す signal)で止まったら、理由を返して打ち切る", async () => {
    const deps: AiRouteDeps = { signal: AbortSignal.timeout(20), createClient: (_c, signal) => createMockClient(500, signal) };
    const list = await events(await call(post(validBody), {}, deps));
    const last = list.at(-1);
    expect(last?.type).toBe("error");
    expect(String(last?.message)).toContain("時間内に終わりませんでした");
  });

  it("無通信で切られないよう heartbeat を送る", async () => {
    const slow: AiRouteDeps = { heartbeatMs: 5, createClient: (_c, signal) => createMockClient(40, signal) };
    const list = await events(await call(post(validBody), {}, slow));
    expect(list.some((e) => e.type === "heartbeat")).toBe(true);
    expect(list.at(-1)?.type).toBe("done");
  });
});

describe("ログ", () => {
  it("AI 版を使わないときは、理由をログに出す(秘密の値は出さない)", async () => {
    logs.length = 0;
    const res = await call(post(validBody), { INVENTORY_AI_MODE: "claude", ANTHROPIC_API_KEY: "sk-ant-secret" });
    expect(res.status).toBe(503);
    const all = logs.join("\n");
    expect(all).toContain('"outcome":"disabled"');
    expect(all).toContain('"reason":"no_privacy_policy"');
    expect(all).not.toContain("sk-ant-secret");
    expect(all).not.toContain(ACCESS_CODE);
  });

  it("Claude SDK の例外は、本番ビルドでクラス名が潰れても種類と HTTP ステータスをログに出す(メッセージは出さない)", async () => {
    logs.length = 0;
    const sdkError = new ClaudeSdk.RateLimitError(429, undefined, `内部の詳細 ${MARKER.source}`, new Headers());
    Object.defineProperty(sdkError, "name", { value: "s" });
    await events(await call(post(validBody), {}, { createClient: () => ({ generate: () => Promise.reject(sdkError) }) }));
    const all = logs.join("\n");
    expect(all).toContain('"outcome":"ai_error"');
    expect(all).toContain('"errorClass":"RateLimitError"');
    expect(all).toContain('"errorStatus":429');
    expect(all).not.toContain(MARKER.source);
  });

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
    const base = { INVENTORY_AI_MODE: "claude", NEXT_PUBLIC_PRIVACY_POLICY_URL: PRIVACY_URL };
    expect(aiConfigFromEnv(env(base)).reason).toBe("no_credentials");
    // 短いアクセスコードは総当たりで当てられるので、AI 版を使わない
    expect(aiConfigFromEnv(env({ ...base, ANTHROPIC_API_KEY: "k", INVENTORY_AI_ACCESS_CODE: "short-code" })).reason).toBe("weak_access_code");
    expect(aiConfigFromEnv(env({ ...base, ANTHROPIC_API_KEY: "k" })).reason).toBe("no_access_code");
    expect(aiConfigFromEnv(env({ ...base, ANTHROPIC_API_KEY: "k", INVENTORY_AI_ACCESS_CODE: ACCESS_CODE })).available).toBe(true);
    expect(aiConfigFromEnv(env({ ...base, ANTHROPIC_API_KEY: "k", INVENTORY_AI_ALLOW_ANONYMOUS: "true" })).available).toBe(true);
  });

  it("claude モードは、プライバシーポリシーの URL(http(s))が無いと使わず、理由を1回だけログに出す", () => {
    resetAiConfigWarningsForTest();
    logs.length = 0;
    const claude = { INVENTORY_AI_MODE: "claude", ANTHROPIC_API_KEY: "sk-ant-secret", INVENTORY_AI_ACCESS_CODE: ACCESS_CODE };
    expect(aiConfigFromEnv(env(claude)).reason).toBe("no_privacy_policy");
    expect(aiConfigFromEnv(env({ ...claude, NEXT_PUBLIC_PRIVACY_POLICY_URL: "javascript:alert(1)" })).reason).toBe("no_privacy_policy");
    expect(aiConfigFromEnv(env({ ...claude, NEXT_PUBLIC_PRIVACY_POLICY_URL: PRIVACY_URL })).available).toBe(true);
    // mock は外部に送らないので、未設定でも使える
    expect(aiConfigFromEnv(env({ INVENTORY_AI_MODE: "mock" })).available).toBe(true);

    const warnings = logs.filter((l) => l.includes("no_privacy_policy"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("NEXT_PUBLIC_PRIVACY_POLICY_URL が未設定です");
    expect(logs.join("\n")).not.toContain("sk-ant-secret");
    expect(logs.join("\n")).not.toContain(ACCESS_CODE);
  });

  it("Vercel 上で共有ストアが無いと使わない。読み取れない上限・0 は止める", () => {
    const vercel = { INVENTORY_AI_MODE: "mock", VERCEL: "1" };
    expect(aiConfigFromEnv(env(vercel)).available).toBe(true); // mock は費用がかからない
    expect(aiConfigFromEnv(env({ ...vercel, INVENTORY_AI_MODE: "claude", ANTHROPIC_API_KEY: "k", INVENTORY_AI_ACCESS_CODE: ACCESS_CODE })).reason).toBe("no_shared_store");
    expect(aiConfigFromEnv(env({ INVENTORY_AI_MODE: "mock", INVENTORY_AI_DAILY_LIMIT: "abc" })).reason).toBe("stopped");
    expect(aiConfigFromEnv(env({ INVENTORY_AI_MODE: "mock", INVENTORY_AI_DAILY_LIMIT: "0" })).reason).toBe("stopped");
    expect(aiConfigFromEnv(env({ INVENTORY_AI_MODE: "chatgpt" })).reason).toBe("invalid_mode");
  });

  it("GET の応答に秘密を含めない", () => {
    const body = aiStatusBody(aiConfigFromEnv(env({ ...BASE_ENV, ANTHROPIC_API_KEY: "sk-secret" })));
    expect(JSON.stringify(body)).not.toContain("sk-secret");
    expect(JSON.stringify(body)).not.toContain(ACCESS_CODE);
    expect(body).toMatchObject({ available: true, mode: "mock", requiresAccessCode: true, consentVersion: CONSENT_VERSION });
  });
});

describe("送信元のハッシュ(共有ストアのキー)", () => {
  it("INVENTORY_RATE_LIMIT_HASH_SECRET を鍵にした HMAC にして置き、IPアドレスはそのまま置かない", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(JSON.stringify([{ result: null }, { result: 0 }]), { status: 200 }));
    const store = {
      UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "token",
      INVENTORY_TRUST_PROXY: "true",
      INVENTORY_RATE_LIMIT_HASH_SECRET: "inventory-hash-secret",
    };
    const source = clientKey(post(validBody), env(store));
    expect(source).toBe("203.0.113.5");
    await call(post(validBody, { "x-access-code": "wrong" }), store);
    await call(post(validBody), store);

    const keys = fetchMock.mock.calls.map((c) => (JSON.parse(String(c[1]?.body)) as string[][])[0][1]);
    const hashed = hashClientKey(source, "inventory-hash-secret");
    expect(keys).toContain(`${KV_KEY_PREFIX}ai-access-fail:src:${hashed}`);
    expect(keys).toContain(`${KV_KEY_PREFIX}rl:ai-document:${hashed}`);
    expect(keys.join("\n")).not.toContain(source);
  });
});

describe("clientKey(回数制限の送信元)", () => {
  const req = (headers: Record<string, string>) => new Request("http://localhost/", { headers });
  it("Vercel 上では x-vercel-forwarded-for を使い、偽装できる x-forwarded-for は使わない", () => {
    expect(clientKey(req({ "x-vercel-forwarded-for": "198.51.100.7", "x-forwarded-for": "1.1.1.1" }), env({ VERCEL: "1" }))).toBe("198.51.100.7");
  });
  it("信頼するプロキシの設定が無ければ転送元のヘッダーを使わず、全員で1つの枠にする", () => {
    expect(clientKey(req({ "x-forwarded-for": "1.1.1.1" }), env({}))).toBe("shared");
  });
  it("INVENTORY_TRUST_PROXY=true のときは、プロキシが付けた末尾の値を使う", () => {
    expect(clientKey(req({ "x-forwarded-for": "6.6.6.6, 198.51.100.8" }), env({ INVENTORY_TRUST_PROXY: "true" }))).toBe("198.51.100.8");
  });
});
