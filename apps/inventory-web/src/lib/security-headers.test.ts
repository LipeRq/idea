import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders, WORKER_SCRIPT_CSP } from "./security-headers";

describe("セキュリティヘッダー", () => {
  it("本番の CSP は外部のオリジンを1つも許可せず、eval も許可しない", () => {
    const csp = contentSecurityPolicy({ isDev: false });
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toMatch(/worker-src 'self'(;|$)/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/https?:|\*/);
  });

  it("解析 Worker のスクリプトの CSP は、同一オリジンを含めて通信・スクリプトの読み込み・Worker の作成をすべて禁止する", () => {
    for (const d of ["default-src 'none'", "connect-src 'none'", "script-src 'none'", "worker-src 'none'"]) expect(WORKER_SCRIPT_CSP).toContain(d);
    expect(WORKER_SCRIPT_CSP).not.toMatch(/'self'|https?:|blob:|unsafe/);
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
