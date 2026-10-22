import { describe, expect, it } from "vitest";
import { SHARED_CLIENT_KEY } from "@idea/shared/http";
import { clientKey } from "./http";

const request = (headers: Record<string, string>) => new Request("http://localhost/api/diagnose", { headers });

describe("clientKey(回数制限の送信元)", () => {
  const headers = { "x-forwarded-for": "198.51.100.7, 203.0.113.1", "x-vercel-forwarded-for": "203.0.113.9" };

  it("Vercel 上では x-vercel-forwarded-for を使う", () => {
    expect(clientKey(request(headers), { NODE_ENV: "test", VERCEL: "1" })).toBe("203.0.113.9");
  });

  it("DIAGNOSIS_TRUST_PROXY=true のときだけ x-forwarded-for の末尾(信頼するプロキシが付けた値)を使う", () => {
    expect(clientKey(request(headers), { NODE_ENV: "test", DIAGNOSIS_TRUST_PROXY: "true" })).toBe("203.0.113.1");
  });

  it("それ以外は偽装できるヘッダーを使わず、全員で1つの枠を共有する", () => {
    expect(clientKey(request(headers), { NODE_ENV: "test" })).toBe(SHARED_CLIENT_KEY);
    expect(clientKey(request({}), { NODE_ENV: "test", VERCEL: "1", DIAGNOSIS_TRUST_PROXY: "true" })).toBe(SHARED_CLIENT_KEY);
  });
});
