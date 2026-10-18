/** 利用者に見せるメッセージを持つエラー(CLI はメッセージだけを表示する) */
export class InventoryError extends Error {}

export class UnsupportedFileError extends InventoryError {}

export class PasswordError extends InventoryError {}
