import { SHARED_CLIENT_KEY } from "@idea/shared/http";
import { clientKey } from "./http";

// Cloudflare Turnstile(ボット対策)のサーバー側の検証。
// サイトキー(NEXT_PUBLIC_TURNSTILE_SITE_KEY)とシークレット(TURNSTILE_SECRET_KEY)の両方があるときだけ有効。
// 画面はトークンを X-Turnstile-Token ヘッダーで送る。

export const TURNSTILE_HEADER = "x-turnstile-token";
export const TURNSTILE_ERROR_MESSAGE =
  "セキュリティ確認が完了していないか、期限が切れています。画面のセキュリティ確認を済ませてから、もう一度お試しください。";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const VERIFY_TIMEOUT_MS = 5_000;
// トークンは2048文字以内(Cloudflare の仕様)
const MAX_TOKEN_LENGTH = 2048;

export type TurnstileAction = "diagnose" | "lead";

let warnedMisconfig = false;

/** 有効ならシークレットを返す。片方だけ設定されていれば、設定の誤りをログに出して無効として扱う */
export function turnstileSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const siteKey = env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  if (siteKey && secret) return secret;
  if ((siteKey || secret) && !warnedMisconfig) {
    warnedMisconfig = true;
    console.error(
      "Turnstile は NEXT_PUBLIC_TURNSTILE_SITE_KEY と TURNSTILE_SECRET_KEY の両方を設定したときだけ有効になります(片方だけのため無効にしています)",
    );
  }
  return null;
}

type SiteverifyResponse = {
  success?: boolean;
  action?: string;
  "error-codes"?: string[];
};

/**
 * トークンを検証する。人による操作と確認できなければ false。
 * Cloudflare に接続できないとき(通信エラー・5xx)は、利用者を締め出さないよう通す(ログには残す)。
 * 回数制限とAIの1日の上限は、このときも効いている。
 */
export async function verifyTurnstileToken(
  token: string | null,
  options: { secret: string; action: TurnstileAction; remoteIp?: string },
): Promise<boolean> {
  if (!token || token.length > MAX_TOKEN_LENGTH) return false;

  const form = new URLSearchParams({ secret: options.secret, response: token });
  if (options.remoteIp) form.set("remoteip", options.remoteIp);

  let res: Response;
  try {
    res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
  } catch (error) {
    console.error(
      "Turnstile の検証サーバーに接続できなかったため、確認を省略しました",
      error instanceof Error ? error.message : error,
    );
    return true;
  }
  if (res.status >= 500) {
    await res.body?.cancel();
    console.error(`Turnstile の検証サーバーが HTTP ${res.status} を返したため、確認を省略しました`);
    return true;
  }

  const body = (await res.json().catch(() => null)) as SiteverifyResponse | null;
  if (!body?.success) {
    const codes = body?.["error-codes"] ?? [];
    if (codes.some((c) => c.endsWith("-input-secret"))) {
      console.error("TURNSTILE_SECRET_KEY が正しくないため、Turnstile の確認がすべて失敗しています");
    } else {
      console.info(`[turnstile] 確認に失敗しました:${codes.join(",") || `HTTP ${res.status}`}`);
    }
    return false;
  }
  // 別の画面(action)で取ったトークンの使い回しを断る
  if (body.action && body.action !== options.action) {
    console.info(`[turnstile] action が一致しません(${body.action})`);
    return false;
  }
  return true;
}

/** リクエストのトークンを検証する。Turnstile が無効なら常に true */
export async function isHumanRequest(
  request: Request,
  action: TurnstileAction,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const secret = turnstileSecret(env);
  if (!secret) return true;
  const ip = clientKey(request, env);
  return verifyTurnstileToken(request.headers.get(TURNSTILE_HEADER), {
    secret,
    action,
    remoteIp: ip === SHARED_CLIENT_KEY ? undefined : ip,
  });
}

/** テスト用:設定の誤りの警告を出し直せるようにする */
export function resetTurnstileWarningForTest(): void {
  warnedMisconfig = false;
}
