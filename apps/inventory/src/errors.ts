/** 利用者に見せるメッセージを持つエラー(CLI はメッセージだけを表示する) */
export class InventoryError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class UnsupportedFileError extends InventoryError {}

export class PasswordError extends InventoryError {}

/** ファイルが壊れている・想定していない構造のため解析できない */
export class CorruptFileError extends InventoryError {}

export type LimitKind = "inputSize" | "partSize" | "totalSize" | "entryCount" | "time";

/** 展開後のサイズ・件数・処理時間などの上限を超えたため解析を中止した(zip 爆弾などの対策) */
export class LimitExceededError extends InventoryError {
  constructor(
    readonly kind: LimitKind,
    message: string,
  ) {
    super(message);
  }
}

/**
 * 部分的な失敗を警告にして続行する catch 節で使う。上限超過は解析全体を止めるべきなので握りつぶさずに投げ直す。
 */
export function rethrowIfFatal(e: unknown): void {
  if (e instanceof LimitExceededError || e instanceof PasswordError) throw e;
}
