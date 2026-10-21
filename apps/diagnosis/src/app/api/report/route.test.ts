import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateDiagnosis } from "@/lib/diagnosis/calculate";
import { buildFallbackReport } from "@/lib/diagnosis/fallback";
import type { AiReport, DiagnosisInput } from "@/lib/diagnosis/schema";
import { fileNameFromDisposition } from "@/lib/report/file-name";
import { signReport } from "@/lib/report/token";
import { readPdf } from "@/test-utils/pdf";
import { POST } from "./route";

const input: DiagnosisInput = {
  companyName: "株式会社髙﨑テスト",
  industry: "製造業",
  employees: "31〜100名",
  hourlyCost: 3_000,
  // 議事録100時間 × 60% × 実現係数1.0 = 月60時間 → 年216万円
  taskHours: { minutes: 100 },
  readiness: { dataLocation: 3, manuals: 3, aiUsage: 3, itStaff: 3, rules: 3, leadership: 3 },
  goals: ["人手不足への対応"],
};
const result = calculateDiagnosis(input);
const aiReport: AiReport = {
  ...buildFallbackReport(result),
  summary: "AIが書いた総評です。議事録の作成から始めるのがおすすめです。",
};

let ipCounter = 0;
function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request("http://localhost/api/report", {
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

async function pdfOf(res: Response) {
  const bytes = new Uint8Array(await res.arrayBuffer());
  expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  return readPdf(bytes);
}

beforeEach(() => {
  // 送信元ごとの回数制限を x-forwarded-for で確かめるため、手前のプロキシを信用する設定にする(src/lib/http.ts の clientKey)
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("DIAGNOSIS_TRUST_PROXY", "true");
  vi.stubEnv("REPORT_SIGNING_SECRET", "test-secret");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("KV_REST_API_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/report", () => {
  it("入力からA4のPDFを作る。日本語が文字化けせず、数値・施策・前提・注意書きが入る", async () => {
    const res = await post({ input });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-report-source")).toBe("standard");
    expect(fileNameFromDisposition(res.headers.get("content-disposition"))).toMatch(
      /^AI導入診断レポート_株式会社髙﨑テスト_\d{8}\.pdf$/,
    );

    const pdf = await pdfOf(res);
    expect(pdf.title).toBe("株式会社髙﨑テスト様のAI導入診断レポート");
    expect(pdf.totalPages).toBeGreaterThanOrEqual(2);
    for (const expected of [
      "株式会社髙﨑テスト様のAI導入診断レポート",
      "年間の削減見込み額",
      "216万円",
      "業務別の年間削減見込み額",
      "優先して取り組む施策",
      "議事録・報告書の作成のAI活用",
      "3ヶ月のロードマップ",
      "試算の前提",
      "実現係数(1。準備度に応じて0.5〜1.0)",
      "1時間あたり3,000円",
      "試算は入力内容と一般的な目安にもとづく概算で、効果を保証するものではありません。",
      "専門家と一緒に深掘りしたいポイント",
    ]) {
      expect(pdf.compact).toContain(expected);
    }
  });

  it("クライアントが送った結果の数値は使わず、入力から計算し直す", async () => {
    const tamperedResult = {
      ...result,
      totals: { ...result.totals, annualSavedAmount: 999_000_000 },
    };
    const res = await post({ input, result: tamperedResult });

    const pdf = await pdfOf(res);
    expect(pdf.compact).toContain("216万円");
    expect(pdf.compact).not.toContain("9.99億円");
  });

  it("署名が一致するAIの文章はPDFに使う", async () => {
    const res = await post({ input, report: aiReport, reportToken: signReport(input, aiReport) });

    expect(res.headers.get("x-report-source")).toBe("ai");
    const pdf = await pdfOf(res);
    expect(pdf.compact).toContain(aiReport.summary.replace(/\s+/g, ""));
    expect(pdf.compact).toContain("文章はAIが作成しています");
  });

  it("書き換えたAIの文章や署名のない文章は使わず、標準文面にする", async () => {
    const tampered = { ...aiReport, summary: "導入すれば必ず売上が倍になります。" };
    for (const body of [
      { input, report: tampered, reportToken: signReport(input, aiReport) },
      { input, report: tampered },
    ]) {
      const res = await post(body);
      expect(res.status).toBe(200);
      expect(res.headers.get("x-report-source")).toBe("standard");
      const pdf = await pdfOf(res);
      expect(pdf.compact).not.toContain("必ず売上が倍");
      expect(pdf.compact).toContain(buildFallbackReport(result).summary.slice(0, 20));
    }
  });

  describe("受け付けないリクエスト", () => {
    it.each([
      ["JSONでない", "{oops"],
      ["入力がない", {}],
      ["入力が不正", { input: { ...input, hourlyCost: 1 } }],
      ["レポートの形が不正", { input, report: { summary: 1 } }],
    ])("%sなら400", async (_, body) => {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(typeof (await res.json()).error).toBe("string");
    });

    it("本文が大きすぎれば413", async () => {
      const res = await post({ input, padding: "x".repeat(100 * 1024) });
      expect(res.status).toBe(413);
    });

    it("回数の上限(RATE_LIMIT_REPORT_PER_HOUR)を超えたら429", async () => {
      vi.stubEnv("RATE_LIMIT_REPORT_PER_HOUR", "1");
      const ip = { "x-forwarded-for": "203.0.113.50" };
      expect((await post({ input: { ...input, hourlyCost: 1 } }, ip)).status).toBe(400);
      expect((await post({ input }, ip)).status).toBe(429);
    });
  });
});
