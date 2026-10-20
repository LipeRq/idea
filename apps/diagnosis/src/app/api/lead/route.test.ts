import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateDiagnosis } from "@/lib/diagnosis/calculate";
import { diagnosisInput } from "@/lib/lead/fixtures.test-helper";
import { POST } from "./route";

const WEBHOOK_URL = "https://example.com/lead-hook";

const contact = {
  companyName: "テスト工業",
  name: "山田 太郎",
  email: "taro@example.co.jp",
  phone: "",
  message: "見積書の作成を効率化したい",
  consent: true,
};

let ipCounter = 0;
function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request("http://localhost/api/lead", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `198.51.100.${++ipCounter}`,
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

function webhookPayloads(fetchMock: { mock: { calls: unknown[][] } }) {
  return fetchMock.mock.calls.map((call) => JSON.parse(String((call[1] as RequestInit).body)));
}

beforeEach(() => {
  // 実際の送信はしない。Webhook の送信先を設定し、fetch をモックする
  vi.stubEnv("SALESFORCE_ORG_ID", "");
  vi.stubEnv("LEAD_WEBHOOK_URL", WEBHOOK_URL);
  vi.stubEnv("LEAD_WEBHOOK_FORMAT", "json");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("KV_REST_API_URL", "");
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/lead", () => {
  it("申し込みを送り、診断結果の要約はサーバーで入力から計算し直して添える", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));

    const res = await post({
      contact: { ...contact, phone: "０３-１２３４-５６７８" },
      website: "",
      input: diagnosisInput,
      // クライアントが送った要約や結果は使わない
      summary: { annualSavedAmount: 999_999_999 },
      result: { totals: { annualSavedAmount: 999_999_999 } },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [payload] = webhookPayloads(fetchMock);
    expect(payload.contact).toEqual({
      companyName: "テスト工業",
      name: "山田 太郎",
      email: "taro@example.co.jp",
      phone: "03-1234-5678",
      message: "見積書の作成を効率化したい",
    });
    const result = calculateDiagnosis(diagnosisInput);
    expect(payload.diagnosis.annualSavedAmount).toBe(result.totals.annualSavedAmount);
    expect(payload.diagnosis.readinessScore).toBe(100);
    expect(payload.diagnosis.topTasks.map((t: { name: string }) => t.name)).toEqual(
      result.top.slice(0, 3).map((t) => t.name),
    );
  });

  it("電話番号が空欄なら送らない", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));
    await post({ contact, input: diagnosisInput });
    expect(webhookPayloads(fetchMock)[0].contact).not.toHaveProperty("phone");
  });

  it("ハニーポットに入力があれば、成功を返すが送らない", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const res = await post({ contact, website: "https://spam.example", input: diagnosisInput });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("入力に誤りがあれば、欄ごとのエラーを400で返す", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const res = await post({
      contact: { ...contact, email: "taro", consent: false, message: " " },
      input: diagnosisInput,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("入力内容をご確認ください");
    expect(Object.keys(body.fieldErrors).sort()).toEqual(["consent", "email", "message"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["JSONでない", "{oops"],
    ["診断の入力がない", { contact }],
    ["診断の入力が不正", { contact, input: { ...diagnosisInput, industry: "宇宙業" } }],
  ])("%sなら400(欄のエラーはなし)", async (_, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect((await res.json()).fieldErrors).toBeUndefined();
  });

  it("本文が大きすぎれば413", async () => {
    const res = await post({ contact: { ...contact, message: "あ".repeat(20_000) }, input: diagnosisInput });
    expect(res.status).toBe(413);
  });

  it("回数の上限(RATE_LIMIT_LEAD_PER_HOUR)を超えたら429", async () => {
    vi.stubEnv("RATE_LIMIT_LEAD_PER_HOUR", "2");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok", { status: 200 }));
    const ip = { "x-forwarded-for": "203.0.113.60" };
    expect((await post({ contact, input: diagnosisInput }, ip)).status).toBe(200);
    expect((await post({ contact, input: diagnosisInput }, ip)).status).toBe(200);
    expect((await post({ contact, input: diagnosisInput }, ip)).status).toBe(429);
  });

  it("送信先が失敗したら502", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));
    const res = await post({ contact, input: diagnosisInput });
    expect(res.status).toBe(502);
  });

  it("本番で送信先が未設定なら503(開発用ログには出さない)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LEAD_WEBHOOK_URL", "");
    const res = await post({ contact, input: diagnosisInput });
    expect(res.status).toBe(503);
  });

  describe("ボット対策(Turnstile)が有効なとき", () => {
    beforeEach(() => {
      vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key");
      vi.stubEnv("TURNSTILE_SECRET_KEY", "secret-key");
    });

    it("トークンがなければ403で、申し込みは送らない", async () => {
      const fetchMock = vi.spyOn(globalThis, "fetch");
      const res = await post({ contact, input: diagnosisInput });
      expect(res.status).toBe(403);
      expect((await res.json()).error).toContain("セキュリティ確認");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("確認できたトークンなら申し込みを送る", async () => {
      const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
        String(url).includes("challenges.cloudflare.com")
          ? Response.json({ success: true, action: "lead" })
          : new Response("ok", { status: 200 }),
      );

      const res = await post({ contact, input: diagnosisInput }, { "x-turnstile-token": "good" });
      expect(res.status).toBe(200);
      expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        WEBHOOK_URL,
      ]);
    });

    it("診断の画面で取ったトークンは使えない", async () => {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(Response.json({ success: true, action: "diagnose" }));
      const res = await post({ contact, input: diagnosisInput }, { "x-turnstile-token": "reused" });
      expect(res.status).toBe(403);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
