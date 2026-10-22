// ブラウザで解析するときの上限(エンジンの既定値より小さくするもの)と、画面側の監視タイマー。
// 数値の根拠は docs/design.md の §3.5(大きなファイルでの計測結果)を参照。
import type { AnalysisLimits } from "@engine/browser";

const MiB = 1024 * 1024;

/** 選べる1ファイルの大きさ(選択時に File.size で判定し、読み込まない) */
export const MAX_FILE_BYTES = 200 * MiB;

/** 一度に選べるファイルの数と、その合計の大きさ(結果にソースを含むため、メモリを使い切らないように) */
export const MAX_FILES = 10;
export const MAX_TOTAL_BYTES = 500 * MiB;

/** エンジンの協調的な制限時間 */
export const ENGINE_TIME_LIMIT_MS = 60_000;

/** エンジンに渡す上限 */
export const ENGINE_LIMITS: Partial<AnalysisLimits> = {
  maxInputBytes: MAX_FILE_BYTES,
  timeLimitMs: ENGINE_TIME_LIMIT_MS,
};

/**
 * 監視タイマー。協調的な確認が届かない処理(1回の展開・正規表現)に備え、画面側で時間切れなら Worker を止める。
 * 読み込み(file.arrayBuffer)の時間は含めない(Worker から phase: analyzing を受けた時点で数え始める)。
 */
export const WATCHDOG_MS = ENGINE_TIME_LIMIT_MS + 15_000;

/** 仕様書の作り直し・AI の送信内容の作成など、ファイルを読まない依頼の監視タイマー */
export const RENDER_WATCHDOG_MS = 60_000;

export function formatFileSize(bytes: number): string {
  if (bytes >= MiB) return `${(bytes / MiB).toFixed(bytes >= 100 * MiB ? 0 : 1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}バイト`;
}
