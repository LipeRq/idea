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
  it("既定では同じオリジンだけを許可し、埋め込み・プラグイン・eval を禁止する(外部のオリジンは1つも許可しない)", () => {
    const csp = contentSecurityPolicy({ isDev: false });
    const d = directives(csp);
    expect(Object.keys(d)).toEqual([
      "default-src",
      "script-src",
      "style-src",
      "img-src",
      "font-src",
      "connect-src",
      "frame-src",
      "object-src",
      "base-uri",
      "form-action",
      "frame-ancestors",
    ]);
    expect(d["default-src"]).toEqual(["'self'"]);
    expect(d["script-src"]).toEqual(["'self'", "'unsafe-inline'"]);
    expect(d["connect-src"]).toEqual(["'self'"]);
    // PDF のダウンロードなどは blob: の URL を使う
    expect(d["img-src"]).toEqual(["'self'", "data:", "blob:"]);
    expect(d["frame-src"]).toEqual(["'none'"]);
    expect(d["frame-ancestors"]).toEqual(["'none'"]);
    expect(d["object-src"]).toEqual(["'none'"]);
    expect(d["base-uri"]).toEqual(["'self'"]);
    expect(d["form-action"]).toEqual(["'self'"]);
    expect(csp).not.toMatch(/https?:|\*|unsafe-eval/);
  });

  it("next dev では React のために 'unsafe-eval' を許可する", () => {
    const d = directives(contentSecurityPolicy({ isDev: true }));
    expect(d["script-src"]).toEqual(["'self'", "'unsafe-inline'", "'unsafe-eval'"]);
  });

  it("アプリが渡した送信元を、各ディレクティブの既定の値の後に順番どおり足す", () => {
    const d = directives(
      contentSecurityPolicy({
        isDev: true,
        scriptSrc: ["https://a.example", "https://b.example"],
        connectSrc: ["https://c.example"],
        imgSrc: ["https://d.example"],
        frameSrc: ["https://e.example"],
      }),
    );
    expect(d["script-src"]).toEqual(["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://a.example", "https://b.example"]);
    expect(d["connect-src"]).toEqual(["'self'", "https://c.example"]);
    expect(d["img-src"]).toEqual(["'self'", "data:", "blob:", "https://d.example"]);
    expect(d["frame-src"]).toEqual(["https://e.example"]);
  });

  it("worker-src は指定したときだけ、connect-src と frame-src の間に出す", () => {
    const csp = contentSecurityPolicy({ isDev: false, workerSrc: ["'self'"] });
    expect(csp).toContain("connect-src 'self'; worker-src 'self'; frame-src 'none'");
    expect(contentSecurityPolicy({ isDev: false })).not.toContain("worker-src");
  });
});

describe("securityHeaders", () => {
  it("CSP と、MIME の推測・埋め込み・リファラ・権限・ウィンドウの分離・HTTPS のヘッダーを返す", () => {
    const list = securityHeaders({ csp: "default-src 'self'" });
    expect(list.map((h) => h.key)).toEqual([
      "Content-Security-Policy",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
      "Permissions-Policy",
      "Cross-Origin-Opener-Policy",
      "Strict-Transport-Security",
    ]);
    const headers = Object.fromEntries(list.map((h) => [h.key, h.value]));
    expect(headers["Content-Security-Policy"]).toBe("default-src 'self'");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(headers["Strict-Transport-Security"]).toBe("max-age=63072000");
  });

  it("既定では参照元を送らず、使わない機能(カメラ・マイク・位置情報・支払い・USB)を止める", () => {
    const headers = Object.fromEntries(securityHeaders().map((h) => [h.key, h.value]));
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["Permissions-Policy"]).toBe("camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  });

  it("CSP を渡さなければ CSP は付けない。リファラと権限はアプリごとに変えられる", () => {
    const list = securityHeaders({ referrerPolicy: "strict-origin-when-cross-origin", permissionsPolicy: "camera=()" });
    const headers = Object.fromEntries(list.map((h) => [h.key, h.value]));
    expect(headers).not.toHaveProperty("Content-Security-Policy");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toBe("camera=()");
  });
});
