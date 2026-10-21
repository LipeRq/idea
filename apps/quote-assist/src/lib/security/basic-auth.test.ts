import { describe, expect, it } from "vitest";
import { accessConfigFromEnv, checkAccess } from "./basic-auth";

const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

describe("Basic 認証(誤公開の歯止め)", () => {
  it("本番で認証の設定がなければ閉じる。片方だけの設定も閉じる", () => {
    expect(accessConfigFromEnv({ NODE_ENV: "production" })).toEqual({ kind: "locked" });
    expect(accessConfigFromEnv({ NODE_ENV: "production", QUOTE_ASSIST_BASIC_AUTH_USER: "u" })).toEqual({ kind: "locked" });
    expect(checkAccess(basic("u", "p"), { kind: "locked" })).toBe("locked");
  });

  it("明示的に解除したとき・開発中は開ける", () => {
    expect(accessConfigFromEnv({ NODE_ENV: "production", QUOTE_ASSIST_ALLOW_NO_AUTH: "true" })).toEqual({ kind: "open" });
    expect(accessConfigFromEnv({ NODE_ENV: "production", QUOTE_ASSIST_ALLOW_NO_AUTH: "1" })).toEqual({ kind: "locked" });
    expect(accessConfigFromEnv({ NODE_ENV: "development" })).toEqual({ kind: "open" });
    expect(checkAccess(null, { kind: "open" })).toBe("allow");
  });

  it("ユーザー名とパスワードがそろえば Basic 認証を求め、一致したときだけ通す", () => {
    const config = accessConfigFromEnv({ NODE_ENV: "production", QUOTE_ASSIST_BASIC_AUTH_USER: "sales", QUOTE_ASSIST_BASIC_AUTH_PASSWORD: "p:ss" });
    expect(config).toEqual({ kind: "basic", user: "sales", password: "p:ss" });
    expect(checkAccess(basic("sales", "p:ss"), config)).toBe("allow");
    expect(checkAccess(basic("sales", "wrong"), config)).toBe("challenge");
    expect(checkAccess(basic("other", "p:ss"), config)).toBe("challenge");
    expect(checkAccess(null, config)).toBe("challenge");
    expect(checkAccess("Bearer abc", config)).toBe("challenge");
    expect(checkAccess("Basic !!!", config)).toBe("challenge");
  });
});
