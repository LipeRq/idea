// Upstash Redis の REST API で、インスタンスをまたいで回数を数える(サーバー専用)。
// SDK は使わず fetch で呼ぶ(使うコマンドは SET・INCR・INCRBY だけ)。
// UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN(Vercel の Marketplace 経由なら KV_REST_API_URL / KV_REST_API_TOKEN)が
// 設定されているときだけ使う。

const REQUEST_TIMEOUT_MS = 2_000;

export type UpstashConfig = {
  url: string;
  token: string;
  /** すべてのキーに付ける接頭辞。他のアプリと同じデータベースを使っても衝突しないよう、アプリごとに変える(例: "ai-diagnosis:") */
  keyPrefix: string;
};

/** 未設定なら null(共有ストアを使わない)。URLの形式が誤っていれば例外 */
export function upstashConfigFromEnv(keyPrefix: string, env: NodeJS.ProcessEnv = process.env): UpstashConfig | null {
  const url = (env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL)?.trim();
  const token = (env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN)?.trim();
  if (!url || !token) return null;
  if (!/^https:\/\/\S+$/i.test(url)) {
    throw new Error("UPSTASH_REDIS_REST_URL は https:// で始まるURLを指定してください");
  }
  return { url: url.replace(/\/+$/, ""), token, keyPrefix };
}

/** コマンドをまとめて(MULTI/EXEC で)実行し、各コマンドの結果を返す。キーの接頭辞は付けない */
export async function upstashTransaction(config: Pick<UpstashConfig, "url" | "token">, commands: string[][]): Promise<unknown[]> {
  const res = await fetch(`${config.url}/multi-exec`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Upstash が HTTP ${res.status} を返しました`);
  if (!Array.isArray(body) || body.length !== commands.length) throw new Error("Upstash の応答を読み取れませんでした");
  return body.map((item: { result?: unknown; error?: unknown } | null) => {
    if (item && typeof item.error === "string") throw new Error(`Upstash: ${item.error}`);
    return item?.result;
  });
}

/**
 * キー(接頭辞を付ける)の値を増やし、増やした後の値を返す。キーは最初に数えたときから ttlMs で消える。
 * SET NX で期限付きの0を置いてから増やすので、期限のないキーが残らない。
 * amount を省くと INCR(1増やす)、指定すると INCRBY(0以上の整数に切り捨て。0 なら今の値を読むだけ)。
 */
export async function incrementWithExpiry(config: UpstashConfig, key: string, ttlMs: number, amount?: number): Promise<number> {
  const fullKey = config.keyPrefix + key;
  const increment = amount === undefined ? ["INCR", fullKey] : ["INCRBY", fullKey, String(Math.max(0, Math.floor(amount)))];
  const [, count] = await upstashTransaction(config, [["SET", fullKey, "0", "PX", String(ttlMs), "NX"], increment]);
  if (typeof count !== "number") throw new Error(`Upstash の ${increment[0]} の結果が数値ではありません`);
  return count;
}
