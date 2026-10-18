import { afterEach, describe, expect, it, vi } from "vitest";
import { calculateDiagnosis } from "../diagnosis/calculate";
import { buildFallbackReport } from "../diagnosis/fallback";
import type { DiagnosisInput } from "../diagnosis/schema";
import { canonicalJson, signReport, verifyReport } from "./token";

const input: DiagnosisInput = {
  companyName: "テスト工業",
  industry: "製造業",
  employees: "31〜100名",
  hourlyCost: 3_000,
  taskHours: { minutes: 100, inquiry: 40 },
  readiness: { dataLocation: 3, manuals: 3, aiUsage: 3, itStaff: 3, rules: 3, leadership: 3 },
  goals: ["コスト削減"],
};
const report = { ...buildFallbackReport(calculateDiagnosis(input)), summary: "AIの総評" };
const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("signReport / verifyReport", () => {
  it("署名した入力とレポートなら検証に通る", () => {
    const token = signReport(input, report, NOW);
    expect(verifyReport(token, input, report, NOW + 1)).toBe(true);
  });

  it("キーの順番が変わっても(JSONの往復など)検証に通る", () => {
    const token = signReport(input, report, NOW);
    const { goals, ...rest } = input;
    const reordered = JSON.parse(
      JSON.stringify({ goals, ...rest, taskHours: { inquiry: 40, minutes: 100 } }),
    );
    expect(verifyReport(token, reordered, report, NOW)).toBe(true);
  });

  it.each([
    ["AIの文章", { input, report: { ...report, summary: "効果を保証します" } }],
    [
      "施策の文章",
      {
        input,
        report: {
          ...report,
          recommendations: report.recommendations.map((r, i) =>
            i === 0 ? { ...r, approach: "書き換え" } : r,
          ),
        },
      },
    ],
    ["会社名", { input: { ...input, companyName: "別の会社" }, report }],
    ["業務時間", { input: { ...input, taskHours: { minutes: 1000 } }, report }],
  ])("%sを書き換えると検証に失敗する", (_, changed) => {
    const token = signReport(input, report, NOW);
    expect(verifyReport(token, changed.input, changed.report, NOW)).toBe(false);
  });

  it("24時間で期限切れになる", () => {
    const token = signReport(input, report, NOW);
    expect(verifyReport(token, input, report, NOW + DAY - 1)).toBe(true);
    expect(verifyReport(token, input, report, NOW + DAY)).toBe(false);
  });

  it("期限の数字を書き換えると検証に失敗する", () => {
    const [, signature] = signReport(input, report, NOW).split(".");
    expect(verifyReport(`${NOW + 10 * DAY}.${signature}`, input, report, NOW)).toBe(false);
  });

  it.each([undefined, "", "abc", "123", "123.", ".sig", "1.2.3", `${NOW + DAY}.短い`])(
    "形式の正しくない署名(%s)は失敗する",
    (token) => {
      expect(verifyReport(token, input, report, NOW)).toBe(false);
    },
  );

  it("REPORT_SIGNING_SECRET が違えば検証に失敗する", () => {
    vi.stubEnv("REPORT_SIGNING_SECRET", "secret-a");
    const token = signReport(input, report, NOW);
    expect(verifyReport(token, input, report, NOW)).toBe(true);
    vi.stubEnv("REPORT_SIGNING_SECRET", "secret-b");
    expect(verifyReport(token, input, report, NOW)).toBe(false);
  });
});

describe("canonicalJson", () => {
  it("キーを並べ替え、undefined の項目は省く", () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: undefined }], e: null })).toBe(
      '{"a":[{"d":2}],"b":1,"e":null}',
    );
  });
});
