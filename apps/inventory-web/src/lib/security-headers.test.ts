import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "./security-headers";

describe("セキュリティヘッダー", () => {
  it("本番の CSP は外部のオリジンを1つも許可せず、eval も許可しない", () => {
    const csp = contentSecurityPolicy({ isDev: false });
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/https?:|\*/);
  });

  it("'unsafe-eval' は next dev のときだけ", () => {
    expect(contentSecurityPolicy({ isDev: true })).toContain("'unsafe-eval'");
  });

  it("参照元を送らない・埋め込ませない", () => {
    const headers = Object.fromEntries(securityHeaders({ isDev: false }).map((h) => [h.key, h.value]));
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
  });
});
