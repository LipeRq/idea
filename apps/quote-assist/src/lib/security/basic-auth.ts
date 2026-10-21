import { createHash, timingSafeEqual } from "node:crypto";

// 誤って公開したときの歯止め(src/proxy.ts から使う)。このアプリには利用者の認証がないため、
// 本番(NODE_ENV=production)では Basic 認証の設定がなければすべてのリクエストを 401 にする(フェイルクローズ)。
//   QUOTE_ASSIST_BASIC_AUTH_USER / QUOTE_ASSIST_BASIC_AUTH_PASSWORD … 両方そろえば Basic 認証を求める(開発中でも有効)
//   QUOTE_ASSIST_ALLOW_NO_AUTH=true … 認証なしで動かすことを明示する(社内ネットワークだけで動かす、前段の別の認証で守る、
//                                     デモ録画など。社外に公開する環境では使わない)

type Env = Record<string, string | undefined>;

export type AccessConfig =
  | { kind: "open" }
  | { kind: "basic"; user: string; password: string }
  /** 本番で認証の設定がない */
  | { kind: "locked" };

export type AccessResult = "allow" | "challenge" | "locked";

export function accessConfigFromEnv(env: Env = process.env): AccessConfig {
  const user = env.QUOTE_ASSIST_BASIC_AUTH_USER ?? "";
  const password = env.QUOTE_ASSIST_BASIC_AUTH_PASSWORD ?? "";
  if (user && password) return { kind: "basic", user, password };
  if (env.QUOTE_ASSIST_ALLOW_NO_AUTH === "true") return { kind: "open" };
  // 片方だけの設定は設定漏れとみなし、本番では開けない
  return env.NODE_ENV === "production" ? { kind: "locked" } : { kind: "open" };
}

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

/** 長さの違いも含めて、比較にかかる時間から中身が分からないようにする */
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

export function checkAccess(authorization: string | null, config: AccessConfig): AccessResult {
  if (config.kind === "open") return "allow";
  if (config.kind === "locked") return "locked";
  const match = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(authorization ?? "");
  if (!match) return "challenge";
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const sep = decoded.indexOf(":");
  if (sep < 0) return "challenge";
  // 両方を必ず比べる(ユーザー名だけ合っているかどうかを時間で知られないように)
  const userOk = safeEqual(decoded.slice(0, sep), config.user);
  const passwordOk = safeEqual(decoded.slice(sep + 1), config.password);
  return userOk && passwordOk ? "allow" : "challenge";
}
