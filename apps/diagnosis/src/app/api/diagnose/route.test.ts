import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateDiagnosis } from "@/lib/diagnosis/calculate";
import { buildFallbackReport } from "@/lib/diagnosis/fallback";
import type { DiagnosisInput } from "@/lib/diagnosis/schema";
import { verifyReport } from "@/lib/report/token";
import { POST } from "./route";

// 実際のAPIは呼ばない。client.beta.messages.stream だけを差し替える
const { streamMock } = vi.hoisted(() => ({ streamMock: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    beta = { messages: { stream: streamMock } };
  },
}));

const validInput: DiagnosisInput = {
  industry: "製造業",
  employees: "31〜100名",
  hourlyCost: 3_000,
  taskHours: { minutes: 100, inquiry: 40 },
  readiness: {
    dataLocation: 3,
    manuals: 3,
    aiUsage: 3,
    itStaff: 3,
    rules: 3,
    leadership: 3,
  },
  goals: ["コスト削減"],
};

// 回数制限(同じIPで1時間5回)に当たらないよう、テストごとに送信元を変える
let ipCounter = 0;
const nextIp = () => `198.51.100.${++ipCounter}`;

function post(
  body: BodyInit,
  headers: Record<string, string> = {},
): Promise<Response> {
  return POST(
    new Request("http://localhost/api/diagnose", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": nextIp(),
        ...headers,
      },
      body,
      // ReadableStream を本文にするときに必要
      duplex: "half",
    } as RequestInit),
  );
}

const postJson = (value: unknown, headers?: Record<string, string>) =>
  post(JSON.stringify(value), headers);

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
  streamMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/diagnose", () => {
  it("APIキーがなければAIを呼ばず標準レポートを返す(aiGenerated: false)", async () => {
    const res = await postJson(validInput);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.aiGenerated).toBe(false);
    const expected = calculateDiagnosis(validInput);
    expect(body.result).toEqual(expected);
    expect(body.report).toEqual(buildFallbackReport(expected));
    expect(body).not.toHaveProperty("reportToken");
    expect(streamMock).not.toHaveBeenCalled();
  });

  it("AIの呼び出しが例外を投げたら標準レポートにフォールバックし、エラー内容は返さない", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    streamMock.mockReturnValue({
      finalMessage: () => Promise.reject(new Error("secret upstream detail")),
    });

    const res = await postJson(validInput);

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("secret upstream detail");
    const body = JSON.parse(text);
    expect(body.aiGenerated).toBe(false);
    expect(body.report).toEqual(buildFallbackReport(calculateDiagnosis(validInput)));
    expect(streamMock).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalled();
  });

  it("AIが辞退(refusal)したら標準レポートにフォールバックする", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.spyOn(console, "error").mockImplementation(() => {});
    streamMock.mockReturnValue({
      finalMessage: () => Promise.resolve({ stop_reason: "refusal", content: [] }),
    });

    const body = await (await postJson(validInput)).json();

    expect(body.aiGenerated).toBe(false);
    expect(body.report).toEqual(buildFallbackReport(calculateDiagnosis(validInput)));
  });

  it("AIが成功すれば aiGenerated: true で、施策は上位業務の順にそろう", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    const fallback = buildFallbackReport(calculateDiagnosis(validInput));
    const aiReport = {
      ...fallback,
      summary: "AIの総評",
      recommendations: [...fallback.recommendations]
        .reverse()
        .map((r) => ({ ...r, title: `AI:${r.taskId}` })),
    };
    streamMock.mockReturnValue({
      finalMessage: () =>
        Promise.resolve({
          stop_reason: "end_turn",
          content: [{ type: "text", text: JSON.stringify(aiReport) }],
        }),
    });

    const body = await (await postJson(validInput)).json();

    expect(body.aiGenerated).toBe(true);
    // PDFを作るときにAIの文章が改ざんされていないことを確かめる署名
    expect(verifyReport(body.reportToken, validInput, body.report)).toBe(true);
    expect(verifyReport(body.reportToken, validInput, { ...body.report, summary: "改ざん" })).toBe(false);
    expect(body.report.summary).toBe("AIの総評");
    expect(body.report.recommendations.map((r: { title: string }) => r.title)).toEqual(
      body.result.top.map((t: { taskId: string }) => `AI:${t.taskId}`),
    );
  });

  it("ANTHROPIC_AUTH_TOKEN だけでもAIを呼ぶ", async () => {
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "token");
    vi.spyOn(console, "error").mockImplementation(() => {});
    streamMock.mockReturnValue({
      finalMessage: () => Promise.reject(new Error("x")),
    });
    await postJson(validInput);
    expect(streamMock).toHaveBeenCalledTimes(1);
  });

  describe("不正な入力は400", () => {
    it.each([
      ["JSONでない本文", "{not json"],
      ["空の本文", ""],
    ])("%s", async (_, raw) => {
      const res = await post(raw);
      expect(res.status).toBe(400);
      expect(typeof (await res.json()).error).toBe("string");
    });

    it.each([
      ["業種がマスターにない", { ...validInput, industry: "宇宙業" }],
      ["人件費が範囲外", { ...validInput, hourlyCost: 999 }],
      ["人件費が整数でない", { ...validInput, hourlyCost: 3000.5 }],
      ["業務時間が負", { ...validInput, taskHours: { minutes: -1 } }],
      ["業務時間が上限超え", { ...validInput, taskHours: { minutes: 10_001 } }],
      ["存在しない業務ID", { ...validInput, taskHours: { minutes: 10, unknown: 5 } }],
      ["準備度が範囲外", { ...validInput, readiness: { ...validInput.readiness, rules: 4 } }],
      ["課題が1,000文字超え", { ...validInput, challenges: "あ".repeat(1_001) }],
    ])("%s", async (_, value) => {
      const res = await postJson(value);
      expect(res.status).toBe(400);
      expect(typeof (await res.json()).error).toBe("string");
    });

    it("業務時間がすべて0なら、そのことをメッセージで返す", async () => {
      const res = await postJson({ ...validInput, taskHours: { minutes: 0 } });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(
        "少なくとも1つの業務に時間を入力してください",
      );
    });

    it("不正な入力ではAIを呼ばない", async () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
      await postJson({ ...validInput, industry: "宇宙業" });
      expect(streamMock).not.toHaveBeenCalled();
    });
  });

  describe("本文のサイズ上限", () => {
    it("Content-Length が上限を超えていれば読まずに413", async () => {
      const res = await post(JSON.stringify(validInput), {
        "content-length": String(1024 * 1024),
      });
      expect(res.status).toBe(413);
    });

    it("Content-Length なしで大きな本文を送っても413", async () => {
      const chunk = new TextEncoder().encode("x".repeat(16 * 1024));
      let sent = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent++ < 64) controller.enqueue(chunk);
          else controller.close();
        },
      });
      const res = await post(stream);
      expect(res.status).toBe(413);
      // 上限を超えた時点で読むのをやめる
      expect(sent).toBeLessThan(64);
    });

    it("課題欄を上限まで書いた正しい入力は通る", async () => {
      const res = await postJson({ ...validInput, challenges: "あ".repeat(1_000) });
      expect(res.status).toBe(200);
    });
  });

  it("回数の上限は RATE_LIMIT_DIAGNOSE_PER_HOUR で変えられる", async () => {
    vi.stubEnv("RATE_LIMIT_DIAGNOSE_PER_HOUR", "1");
    const ip = "203.0.113.88";
    expect((await postJson(validInput, { "x-forwarded-for": ip })).status).toBe(200);
    expect((await postJson(validInput, { "x-forwarded-for": ip })).status).toBe(429);
  });

  it("同じ送信元から1時間に6回目のリクエストは429", async () => {
    const ip = "203.0.113.77";
    for (let i = 0; i < 5; i++) {
      const res = await postJson(validInput, { "x-forwarded-for": ip });
      expect(res.status).toBe(200);
    }
    const limited = await postJson(validInput, { "x-forwarded-for": ip });
    expect(limited.status).toBe(429);
    // 別の送信元は影響を受けない
    expect((await postJson(validInput)).status).toBe(200);
  });
});
