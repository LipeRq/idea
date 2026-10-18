import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { AiReport, DiagnosisInput } from "../diagnosis/schema";

// AIが書いたレポートの文章に付ける署名。PDFを作るときに、クライアントから戻ってきた文章が
// このサーバーで生成したものと同じかを確かめる(数値は署名に関係なく入力から計算し直す)。

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

let processSecret: string | undefined;

function signingSecret(): string {
  const configured = process.env.REPORT_SIGNING_SECRET;
  if (configured) return configured;
  // 未設定ならプロセスごとの乱数を使う。再起動後や別インスタンスでは検証に失敗し、
  // PDFはAIの文章の代わりに標準文面で作られる(数値は同じ)
  if (!processSecret) {
    processSecret = randomBytes(32).toString("hex");
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "REPORT_SIGNING_SECRET が未設定です。複数インスタンスや再起動後は、PDFのAI文章が標準文面になります",
      );
    }
  }
  return processSecret;
}

/** キーの順番に左右されないJSON(署名する側と検証する側で同じ文字列にするため) */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function mac(expiresAt: number, input: DiagnosisInput, report: AiReport): string {
  return createHmac("sha256", signingSecret())
    .update(canonicalJson({ v: 1, expiresAt, input, report }))
    .digest("base64url");
}

export function signReport(
  input: DiagnosisInput,
  report: AiReport,
  now = Date.now(),
): string {
  const expiresAt = now + TOKEN_TTL_MS;
  return `${expiresAt}.${mac(expiresAt, input, report)}`;
}

export function verifyReport(
  token: string | undefined,
  input: DiagnosisInput,
  report: AiReport,
  now = Date.now(),
): boolean {
  if (!token) return false;
  const [expiresPart, signature, ...rest] = token.split(".");
  const expiresAt = Number(expiresPart);
  if (rest.length > 0 || !signature || !Number.isSafeInteger(expiresAt) || expiresAt <= now) {
    return false;
  }
  const expected = Buffer.from(mac(expiresAt, input, report));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
