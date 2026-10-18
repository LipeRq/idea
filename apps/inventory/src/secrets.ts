// 接続文字列などに含まれるパスワードの検出と伏せ字。

export function maskSecrets(text: string): string {
  return text.replace(/((?:Password|Pwd)\s*=\s*)("[^"]*"|'[^']*'|[^;\r\n]*)/gi, "$1****");
}

/** ソースコード中の接続文字列リテラルに含まれるパスワードだけを伏せる(変数への代入 Pwd = x は対象外) */
export function maskSecretsInSource(source: string): string {
  return source.replace(/([;"][ \t]*(?:Password|Pwd)[ \t]*=[ \t]*)([^;"\r\n]*)/gi, "$1****");
}

export function hasCredentials(text: string): boolean {
  return /(?:Password|Pwd)\s*=\s*[^;\s]/i.test(text);
}
