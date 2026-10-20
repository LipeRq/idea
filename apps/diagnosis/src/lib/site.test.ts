import { describe, expect, it } from "vitest";
import { isIndexable, operatorName, reportBrandName, siteUrl } from "./site";

const env = (values: Record<string, string>): NodeJS.ProcessEnv => ({ NODE_ENV: "test", ...values });

describe("siteUrl", () => {
  it("NEXT_PUBLIC_SITE_URL → Vercel の本番ドメイン → localhost の順に使う", () => {
    expect(
      siteUrl(
        env({
          NEXT_PUBLIC_SITE_URL: "https://shindan.example.co.jp",
          VERCEL_PROJECT_PRODUCTION_URL: "ai-diagnosis.vercel.app",
        }),
      ).href,
    ).toBe("https://shindan.example.co.jp/");
    expect(siteUrl(env({ VERCEL_PROJECT_PRODUCTION_URL: "ai-diagnosis.vercel.app" })).href).toBe(
      "https://ai-diagnosis.vercel.app/",
    );
    expect(siteUrl(env({})).href).toBe("http://localhost:3000/");
    expect(siteUrl(env({ PORT: "3200" })).href).toBe("http://localhost:3200/");
  });

  it("http(s) でない値は使わない", () => {
    expect(siteUrl(env({ NEXT_PUBLIC_SITE_URL: "javascript:alert(1)" })).href).toBe(
      "http://localhost:3000/",
    );
  });
});

describe("運営者名(REPORT_BRAND_NAME)", () => {
  it("設定すればサイトとPDFの両方に使い、未設定ならPDFはサービス名にする", () => {
    expect(operatorName(env({ REPORT_BRAND_NAME: " 株式会社サンプル " }))).toBe("株式会社サンプル");
    expect(reportBrandName(env({ REPORT_BRAND_NAME: "株式会社サンプル" }))).toBe("株式会社サンプル");
    expect(operatorName(env({}))).toBeUndefined();
    expect(reportBrandName(env({ REPORT_BRAND_NAME: " " }))).toBe("AI導入診断");
  });
});

describe("isIndexable", () => {
  it("Vercel のプレビュー環境だけ検索エンジンに載せない", () => {
    expect(isIndexable(env({}))).toBe(true);
    expect(isIndexable(env({ VERCEL_ENV: "production" }))).toBe(true);
    expect(isIndexable(env({ VERCEL_ENV: "preview" }))).toBe(false);
    expect(isIndexable(env({ VERCEL_ENV: "development" }))).toBe(false);
  });
});
