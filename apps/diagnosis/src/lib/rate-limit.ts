import { createHourlyLimiter, limitFromEnv } from "@idea/shared/rate-limit";
import { KV_KEY_PREFIX } from "./kv";

// 送信元ごとの1時間あたりの回数制限(仕組みは packages/shared の rate-limit.ts)。
// Upstash Redis が設定されていればインスタンスをまたいで数え(サーバーレスでも効く)、
// なければサーバーのインスタンス内のメモリで数える。共有ストアに接続できないときもメモリで数える(受付は止めない)。
// 上限は呼び出しのたびに環境変数から読むので、再起動せずにテストや運用で変えられる。
// 共有ストアのキーに置く送信元(IPアドレス)は、DIAGNOSIS_RATE_LIMIT_HASH_SECRET を鍵にした HMAC-SHA256 にする
// (専用の秘密の値。REPORT_SIGNING_SECRET などは流用しない。本番で未設定なら警告し、鍵なしの SHA-256 で数える)。

/** 送信元のハッシュの鍵を入れる環境変数 */
export const RATE_LIMIT_HASH_SECRET_ENV = "DIAGNOSIS_RATE_LIMIT_HASH_SECRET";

/** 共有ストアを使う版。上限を超えていれば true */
export type SharedRateLimiter = (key: string) => Promise<boolean>;

function sharedRateLimiter(name: string, envName: string, defaultLimit: number): SharedRateLimiter {
  const check = createHourlyLimiter({
    name,
    keyPrefix: KV_KEY_PREFIX,
    onStoreError: "memory",
    hashSecretEnv: RATE_LIMIT_HASH_SECRET_ENV,
  });
  return async (key) => (await check(key, limitFromEnv(envName, defaultLimit))) === "limited";
}

/** 診断(AIを呼ぶので最も厳しく) */
export const isDiagnoseRateLimited = sharedRateLimiter("diagnose", "RATE_LIMIT_DIAGNOSE_PER_HOUR", 5);
/** PDFレポートの作成 */
export const isReportRateLimited = sharedRateLimiter("report", "RATE_LIMIT_REPORT_PER_HOUR", 30);
/** 無料相談の申し込み */
export const isLeadRateLimited = sharedRateLimiter("lead", "RATE_LIMIT_LEAD_PER_HOUR", 5);
