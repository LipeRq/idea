// Upstash Redis の REST API で、インスタンスをまたいで回数を数える。
// SDK は使わず fetch で呼ぶ(使うコマンドは SET と INCR だけ)。
// UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN(Vercel の Marketplace 経由なら KV_REST_API_URL / KV_REST_API_TOKEN)が
// 設定されているときだけ使う。

const REQUEST_TIMEOUT_MS = 2_000;
// 他のアプリと同じデータベースを使っても衝突しないよう、キーに付ける
const KEY_PREFIX = "ai-diagnosis:";

export type UpstashConfig = { url: string; token: string };

/** 未設定なら null(共有ストアを使わない)。URLの形式が誤っていれば例外 */
export function upstashConfigFromEnv(env: NodeJS.ProcessEnv = process.env): UpstashConfig | null {
  const url = (env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL)?.trim();
  const token = (env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN)?.trim();
  if (!url || !token) return null;
  if (!/^https:\/\/\S+$/i.test(url)) {
    throw new Error("UPSTASH_REDIS_REST_URL は https:// で始まるURLを指定してください");
  }
  return { url: url.replace(/\/+$/, ""), token };
}

/** コマンドをまとめて(MULTI/EXEC で)実行し、各コマンドの結果を返す */
export async function upstashTransaction(
  config: UpstashConfig,
  commands: string[][],
): Promise<unknown[]> {
  const res = await fetch(`${config.url}/multi-exec`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Upstash が HTTP ${res.status} を返しました`);
  }
  if (!Array.isArray(body) || body.length !== commands.length) {
    throw new Error("Upstash の応答を読み取れませんでした");
  }
  return body.map((item: { result?: unknown; error?: unknown } | null) => {
    if (item && typeof item.error === "string") throw new Error(`Upstash: ${item.error}`);
    return item?.result;
  });
}

/**
 * キーの値を1増やし、増やした後の値を返す。キーは最初に数えたときから ttlMs で消える。
 * SET NX で期限付きの0を置いてから INCR するので、期限のないキーが残らない。
 */
export async function incrementWithExpiry(
  config: UpstashConfig,
  key: string,
  ttlMs: number,
): Promise<number> {
  const fullKey = KEY_PREFIX + key;
  const [, count] = await upstashTransaction(config, [
    ["SET", fullKey, "0", "PX", String(ttlMs), "NX"],
    ["INCR", fullKey],
  ]);
  if (typeof count !== "number") {
    throw new Error("Upstash の INCR の結果が数値ではありません");
  }
  return count;
}
