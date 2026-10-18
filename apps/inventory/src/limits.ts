// 信頼できないファイル(顧客から受け取った不明なファイル)を解析するときの上限。
// 壊れた・悪意のあるファイルで、メモリを使い果たしたり処理が終わらなくなったりしないようにする。
import { LimitExceededError } from "./errors";

export interface AnalysisLimits {
  /** 入力ファイルの最大サイズ(Access の上限 2GB に合わせる) */
  maxInputBytes: number;
  /** zip(.xlsm 等)に含まれるファイル数の上限 */
  maxZipEntries: number;
  /** 1つの部品(zip 内のファイル・OLE のストリーム)の展開後の最大サイズ */
  maxPartBytes: number;
  /** ファイルから取り出す(展開する)データの合計の上限 */
  maxTotalBytes: number;
  /** 1つの VBA モジュールのソース(解凍後)の最大サイズ */
  maxModuleSourceBytes: number;
  /** VBA モジュール数の上限(超えた分は警告して読まない) */
  maxVbaModules: number;
  /** シート数の上限(超えた分は警告して読まない) */
  maxSheets: number;
  /** 名前定義・コントロールなど一覧の件数の上限(超えた分は警告して読まない) */
  maxListItems: number;
  /** Access のテーブル数の上限(超えた分は警告して読まない) */
  maxAccessTables: number;
  /** Access のシステムテーブルから読む最大行数 */
  maxSystemRows: number;
  /** 解析全体の制限時間(ミリ秒) */
  timeLimitMs: number;
}

const MiB = 1024 * 1024;

export const DEFAULT_LIMITS: AnalysisLimits = {
  maxInputBytes: 2048 * MiB,
  maxZipEntries: 20_000,
  maxPartBytes: 256 * MiB,
  maxTotalBytes: 1024 * MiB,
  maxModuleSourceBytes: 32 * MiB,
  maxVbaModules: 5_000,
  maxSheets: 10_000,
  maxListItems: 100_000,
  maxAccessTables: 5_000,
  maxSystemRows: 1_000_000,
  timeLimitMs: 120_000,
};

export function formatBytes(n: number): string {
  if (n >= MiB) return `${(n / MiB).toFixed(n >= 100 * MiB ? 0 : 1)}MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${n}バイト`;
}

const CLOCK_INTERVAL = 256;

/**
 * 解析1回分の予算(制限時間・取り出したデータ量)。ループの中で check() を呼び、上限を超えたら LimitExceededError を投げる。
 * 同期処理なので時間切れは協調的にしか検出できない(1回の正規表現・展開の途中では止まらない)。
 */
export class Budget {
  readonly limits: AnalysisLimits;
  private readonly deadline: number;
  private readonly now: () => number;
  private calls = 0;
  private totalBytes = 0;

  constructor(limits: Partial<AnalysisLimits> = {}, now: () => number = Date.now) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.now = now;
    this.deadline = now() + this.limits.timeLimitMs;
  }

  /** 制限時間を確認する(時計は数百回に1回だけ読む) */
  check(): void {
    if (++this.calls % CLOCK_INTERVAL === 0) this.checkNow();
  }

  /** 制限時間をすぐに確認する */
  checkNow(): void {
    if (this.now() > this.deadline) {
      throw new LimitExceededError(
        "time",
        `解析が制限時間(${Math.round(this.limits.timeLimitMs / 1000)}秒)を超えたため中止しました。ファイルが壊れているか、極端に大きい・複雑な可能性があります。`,
      );
    }
  }

  /** 1つの部品の(宣言された・実際の)展開後サイズを確認する */
  ensurePartSize(bytes: number, what: string): void {
    if (bytes > this.limits.maxPartBytes) {
      throw new LimitExceededError(
        "partSize",
        `${what}の展開後のサイズ(${formatBytes(bytes)})が上限(${formatBytes(this.limits.maxPartBytes)})を超えるため、解析を中止しました。ファイルが壊れているか、展開すると極端に大きくなるファイル(zip 爆弾など)の可能性があります。`,
      );
    }
  }

  /** ファイルから取り出したデータ量を加算し、合計の上限を確認する */
  consume(bytes: number, what: string): void {
    this.ensurePartSize(bytes, what);
    this.totalBytes += bytes;
    if (this.totalBytes > this.limits.maxTotalBytes) {
      throw new LimitExceededError(
        "totalSize",
        `ファイルから取り出したデータの合計が上限(${formatBytes(this.limits.maxTotalBytes)})を超えたため、解析を中止しました(${what} の読み込み中)。ファイルが壊れているか、展開すると極端に大きくなるファイルの可能性があります。`,
      );
    }
    this.checkNow();
  }

  /** 件数が上限を超えていたら警告を出し、読む件数を返す */
  cap<T>(items: T[], max: number, warnings: string[], label: string): T[] {
    if (items.length <= max) return items;
    warnings.push(`${label}が ${items.length} 件あり上限(${max} 件)を超えるため、先頭の ${max} 件だけを解析しました`);
    return items.slice(0, max);
  }
}
