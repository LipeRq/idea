import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "./security-headers";

function directives(csp: string): Record<string, string[]> {
  return Object.fromEntries(
    csp.split(";").map((d) => {
      const [name, ...values] = d.trim().split(/\s+/);
      return [name, values];
    }),
  );
}

describe("contentSecurityPolicy", () => {
  it("既定では同じオリジンだけを許可し、埋め込み・プラグイン・eval を禁止する", () => {
    const d = directives(contentSecurityPolicy({ isDev: false, turnstile: false }));
    expect(d["default-src"]).toEqual(["'self'"]);
    expect(d["script-src"]).toEqual(["'self'", "'unsafe-inline'"]);
    expect(d["connect-src"]).toEqual(["'self'"]);
    // PDFのダウンロードは blob: のURLを使う
    expect(d["img-src"]).toEqual(["'self'", "data:", "blob:"]);
    expect(d["frame-src"]).toEqual(["'none'"]);
    expect(d["frame-ancestors"]).toEqual(["'none'"]);
    expect(d["object-src"]).toEqual(["'none'"]);
    expect(d["base-uri"]).toEqual(["'self'"]);
    expect(d["form-action"]).toEqual(["'self'"]);
  });

  it("next dev では React のために 'unsafe-eval' を許可する", () => {
    const d = directives(contentSecurityPolicy({ isDev: true, turnstile: false }));
    expect(d["script-src"]).toContain("'unsafe-eval'");
  });

  it("Turnstile を使うときは、スクリプトとiframeに challenges.cloudflare.com を許可する", () => {
    const d = directives(contentSecurityPolicy({ isDev: false, turnstile: true }));
    expect(d["script-src"]).toContain("https://challenges.cloudflare.com");
    expect(d["frame-src"]).toEqual(["https://challenges.cloudflare.com"]);
  });

  it("GA4 を使うときは、Google タグの送信先を許可する", () => {
    const d = directives(contentSecurityPolicy({ isDev: false, turnstile: false, analytics: "ga4" }));
    expect(d["script-src"]).toContain("https://*.googletagmanager.com");
    expect(d["connect-src"]).toEqual(
      expect.arrayContaining(["https://*.google-analytics.com", "https://*.analytics.google.com"]),
    );
    expect(d["img-src"]).toContain("https://*.google-analytics.com");
  });

  it("Vercel Web Analytics は本番では同じオリジンなので、外部を許可しない(next dev だけ許可)", () => {
    const prod = directives(contentSecurityPolicy({ isDev: false, turnstile: false, analytics: "vercel" }));
    expect(prod["script-src"]).toEqual(["'self'", "'unsafe-inline'"]);
    const dev = directives(contentSecurityPolicy({ isDev: true, turnstile: false, analytics: "vercel" }));
    expect(dev["script-src"]).toContain("https://va.vercel-scripts.com");
  });
});

describe("securityHeaders", () => {
  it("CSPと、MIMEの推測・埋め込み・リファラ・権限・HTTPSのヘッダーを返す", () => {
    const headers = Object.fromEntries(
      securityHeaders({ isDev: false, turnstile: false }).map((h) => [h.key, h.value]),
    );
    expect(Object.keys(headers).sort()).toEqual([
      "Content-Security-Policy",
      "Permissions-Policy",
      "Referrer-Policy",
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "X-Frame-Options",
    ]);
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
  });
});
