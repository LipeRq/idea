// 両方の機能が使う Claude のモデル。費用を抑えるため Haiku 5.5 にしている(Opus 5.5 の約40分の1)。
// 質を上げたいときは "claude-opus-5-5" にする(Opus ではサーバー側フォールバックも使う。claude.ts)。
export const MODEL: string = "claude-haiku-5-5";

/** Haiku 5.5 にはサーバー側フォールバックがないので、fallbacks を送らない */
export const USE_SERVER_FALLBACK = MODEL !== "claude-haiku-5-5";
