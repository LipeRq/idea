// AI 版(/api/ai-document)の設定。呼び出しのたびに環境変数から読む(再起動せずにテスト・運用で変えられる)。
// 費用の歯止め:
// - claude モードは ANTHROPIC_API_KEY(または ANTHROPIC_AUTH_TOKEN)と、アクセスコード(INVENTORY_AI_ACCESS_CODE)が
//   そろったときだけ有効(既定はコンサルタント専用。匿名で公開するときだけ INVENTORY_AI_ALLOW_ANONYMOUS=true)
// - 本番(Vercel 上、または INVENTORY_AI_REQUIRE_SHARED_STORE=true)では、回数を共有ストア(Upstash)で数えられないときは使わない
//   (サーバーレスではインスタンスごとのメモリで数えても上限にならないため)
// - 1日の回数と、1日の推定入力トークンの両方に上限を持つ。読み取れない値は「使わない」側に倒す
import { CONSENT_VERSION } from "@/lib/ai-consent";
import { kvConfigFromEnv } from "./kv";

export type AiMode = "off" | "claude" | "mock";

export type UnavailableReason =
  | "off"
  | "invalid_mode"
  | "no_credentials"
  | "no_access_code"
  | "weak_access_code"
  | "no_shared_store"
  | "invalid_shared_store"
  | "stopped";

export interface AiServerConfig {
  mode: AiMode;
  available: boolean;
  reason: UnavailableReason | null;
  accessCode: string | null;
  /** 誤ったアクセスコードの試行の上限(1時間あたり。送信元ごと / サイト全体) */
  accessFailuresPerSource: number;
  accessFailuresSite: number;
  perHour: number;
  dailyLimit: number;
  dailyInputTokens: number;
  maxInputTokens: number;
  maxBatches: number;
  maxBodyBytes: number;
  requireSharedStore: boolean;
  hasSharedStore: boolean;
  mockDelayMs: number;
}

/** アクセスコードの最低の長さ(短いと総当たりで当てられるため、短ければ AI 版を使わない) */
export const MIN_ACCESS_CODE_LENGTH = 16;

export const DEFAULTS = {
  accessFailuresPerSource: 5,
  accessFailuresSite: 50,
  perHour: 3,
  dailyLimit: 20,
  dailyInputTokens: 2_000_000,
  maxInputTokens: 200_000,
  maxBatches: 8,
  // Vercel の関数はリクエスト本文が 4.5MB まで(超えるとプラットフォームが JSON でない 413 を返す)。それより小さくする
  maxBodyBytes: 4_000_000,
  mockDelayMs: 300,
} as const;

type IntResult = { value: number; invalid: boolean };

function intFromEnv(raw: string | undefined, fallback: number): IntResult {
  const text = raw?.trim();
  if (!text) return { value: fallback, invalid: false };
  const value = Number(text);
  if (Number.isInteger(value) && value >= 0) return { value, invalid: false };
  return { value: 0, invalid: true };
}

export function aiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AiServerConfig {
  const rawMode = env.INVENTORY_AI_MODE?.trim().toLowerCase() || "off";
  const mode: AiMode = rawMode === "claude" || rawMode === "mock" ? rawMode : "off";
  const accessCode = env.INVENTORY_AI_ACCESS_CODE?.trim() || null;
  const requireSharedStore = Boolean(env.VERCEL?.trim()) || env.INVENTORY_AI_REQUIRE_SHARED_STORE?.trim() === "true";

  let hasSharedStore = false;
  let storeInvalid = false;
  try {
    hasSharedStore = kvConfigFromEnv(env) !== null;
  } catch {
    storeInvalid = true;
  }

  // 費用に関わる上限は、読み取れない値なら 0(AI を使わない)にする
  const daily = intFromEnv(env.INVENTORY_AI_DAILY_LIMIT, DEFAULTS.dailyLimit);
  const dailyTokens = intFromEnv(env.INVENTORY_AI_DAILY_INPUT_TOKENS, DEFAULTS.dailyInputTokens);
  const perHour = intFromEnv(env.INVENTORY_AI_PER_HOUR, DEFAULTS.perHour);
  const maxInput = intFromEnv(env.INVENTORY_AI_MAX_INPUT_TOKENS, DEFAULTS.maxInputTokens);
  const maxBatches = intFromEnv(env.INVENTORY_AI_MAX_BATCHES, DEFAULTS.maxBatches);
  const maxBody = intFromEnv(env.INVENTORY_AI_MAX_BODY_BYTES, DEFAULTS.maxBodyBytes);
  const mockDelay = intFromEnv(env.INVENTORY_AI_MOCK_DELAY_MS, DEFAULTS.mockDelayMs);
  const failSource = intFromEnv(env.INVENTORY_AI_ACCESS_FAILURES_PER_HOUR, DEFAULTS.accessFailuresPerSource);
  const failSite = intFromEnv(env.INVENTORY_AI_ACCESS_FAILURES_SITE_PER_HOUR, DEFAULTS.accessFailuresSite);

  let reason: UnavailableReason | null = null;
  if (rawMode !== "off" && mode === "off") reason = "invalid_mode";
  else if (mode === "off") reason = "off";
  else if (storeInvalid) reason = "invalid_shared_store";
  else if (accessCode !== null && [...accessCode].length < MIN_ACCESS_CODE_LENGTH) reason = "weak_access_code";
  else if (mode === "claude") {
    if (!(env.ANTHROPIC_API_KEY?.trim() || env.ANTHROPIC_AUTH_TOKEN?.trim())) reason = "no_credentials";
    else if (!accessCode && env.INVENTORY_AI_ALLOW_ANONYMOUS?.trim() !== "true") reason = "no_access_code";
    else if (requireSharedStore && !hasSharedStore) reason = "no_shared_store";
  }
  if (reason === null && (daily.value === 0 || dailyTokens.value === 0 || perHour.value === 0)) reason = "stopped";

  return {
    mode,
    available: reason === null,
    reason,
    accessCode,
    accessFailuresPerSource: failSource.value,
    accessFailuresSite: failSite.value,
    perHour: perHour.value,
    dailyLimit: daily.value,
    dailyInputTokens: dailyTokens.value,
    maxInputTokens: maxInput.value,
    maxBatches: maxBatches.value,
    maxBodyBytes: maxBody.value,
    requireSharedStore,
    hasSharedStore,
    mockDelayMs: mockDelay.value,
  };
}

/** GET /api/ai-document の応答(秘密を含めない) */
export function aiStatusBody(config: AiServerConfig) {
  return {
    available: config.available,
    mode: config.available ? config.mode : "off",
    requiresAccessCode: config.available && config.accessCode !== null,
    maxInputTokens: config.maxInputTokens,
    maxBatches: config.maxBatches,
    maxBodyBytes: config.maxBodyBytes,
    consentVersion: CONSENT_VERSION,
  };
}
