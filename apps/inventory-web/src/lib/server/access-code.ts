import { createHash, timingSafeEqual } from "node:crypto";

// アクセスコードの照合。timingSafeEqual は長さが違うと例外を投げるので、両方を SHA-256 にして同じ長さにしてから比べる。
export function accessCodeMatches(given: string | null, expected: string): boolean {
  if (given === null) return false;
  const a = createHash("sha256").update(given, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

/** 画面は X-Access-Code を encodeURIComponent して送る(ヘッダーに日本語を入れられないため) */
export function readAccessCode(request: Request): string | null {
  const raw = request.headers.get("x-access-code");
  if (raw === null) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
