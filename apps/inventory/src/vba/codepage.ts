import iconv from "iconv-lite";

const SPECIAL: Record<number, string> = {
  1200: "utf16le",
  1201: "utf16be",
  65001: "utf8",
  20127: "ascii",
  28591: "latin1",
  10000: "macroman",
};

/** Windowsのコードページ番号を iconv-lite のエンコーディング名に変換する。未対応なら null。 */
export function encodingForCodePage(codePage: number): string | null {
  const name = SPECIAL[codePage] ?? `cp${codePage}`;
  return iconv.encodingExists(name) ? name : null;
}

/** MBCS 文字列をコードページに従ってデコードする。未対応のコードページは cp1252 で読む。 */
export function decodeText(bytes: Uint8Array, codePage: number): string {
  return iconv.decode(bytes, encodingForCodePage(codePage) ?? "cp1252");
}

export function decodeUtf16(bytes: Uint8Array): string {
  return iconv.decode(bytes, "utf16le");
}
