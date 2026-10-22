// Claude の構造化出力(output_config.format に JSON スキーマを渡した応答)の取り出しと検証。
//
// 各アプリは SDK にスキーマだけを渡し(betaZodOutputFormat(schema).schema)、解析はここで行う。
// parse つきの形式(betaZodOutputFormat そのもの)を渡すと、SDK がテキストブロックを1つずつ解析するため、
// 生成の途中でサーバー側フォールバックが起きた応答では、途中までの文の解析で例外になり、
// 切り替え後のモデルが書いた正しい出力まで失われる(出力上限・辞退の判定より先に例外になる)。
//
// SDK・zod はこのパッケージの依存にしない(アプリの zod と別の実体になると設定や instanceof が合わない)。
// 型は使う部分だけを構造で受け取る。

/** 応答の content の1要素(SDK の BetaContentBlock を構造で受け取る) */
export type ContentBlockLike = { readonly type: string; readonly text?: unknown };

/** 検証に使うスキーマ(zod のスキーマを想定。safeParse だけを使う) */
export type SafeParser<T> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
};

/**
 * 応答の本文から構造化出力(JSON)を取り出し、スキーマで検証する。取り出せなければ null。
 *
 * 生成の途中でフォールバックが起きると、content は [途中までの text, fallback, 切り替え後の text] になる
 * (ストリーミングでは途中までの文も残る)。切り替え後のモデルは途中までの文を続きの文脈として受け取るので、
 * 最後の fallback より後の text だけで完結する場合を優先し、次に前の区切りからつなげた場合を試す
 * (最後の fallback の直後 → その前の fallback の直後 → … → 先頭)。
 */
export function parseStructuredOutput<T>(content: readonly ContentBlockLike[], schema: SafeParser<T>): T | null {
  const starts = [...content.flatMap((b, i) => (b.type === "fallback" ? [i + 1] : [])).reverse(), 0];
  const textFrom = (start: number) =>
    content
      .slice(start)
      .flatMap((b) => (b.type === "text" && typeof b.text === "string" ? [b.text] : []))
      .join("");
  for (const text of new Set(starts.map(textFrom))) {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      continue;
    }
    const parsed = schema.safeParse(json);
    if (parsed.success) return parsed.data;
  }
  return null;
}
