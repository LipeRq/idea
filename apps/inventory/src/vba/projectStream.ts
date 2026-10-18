// [MS-OVBA] 2.3.1 PROJECT Stream(テキスト)の解析と、2.4.3 Data Encryption の復号。
import { decodeText } from "./codepage";

export type ProjectModuleKind = "standard" | "class" | "document" | "designer";

export interface ProjectStreamInfo {
  moduleKinds: Map<string, ProjectModuleKind>;
  /** パスワードで「プロジェクトを表示用にロック」されているか。判定できなければ null */
  lockedForViewing: boolean | null;
  hasPassword: boolean | null;
}

export function parseProjectStream(bytes: Uint8Array, codePage: number): ProjectStreamInfo {
  const moduleKinds = new Map<string, ProjectModuleKind>();
  let lockedForViewing: boolean | null = null;
  let hasPassword: boolean | null = null;

  // PROJECT ストリームは通常数 KB。壊れたファイルで巨大でも先頭だけを見れば十分
  for (const line of decodeText(bytes.subarray(0, 4 * 1024 * 1024), codePage).split(/\r\n|\r|\n/)) {
    if (line.startsWith("[")) break; // [Host Extender Info] 以降はモジュール情報ではない
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const value = line.slice(eq + 1).trim();
    const name = (v: string) => v.split("/")[0].toLowerCase();
    if (key === "module") moduleKinds.set(name(value), "standard");
    else if (key === "class") moduleKinds.set(name(value), "class");
    else if (key === "document") moduleKinds.set(name(value), "document");
    else if (key === "baseclass") moduleKinds.set(name(value), "designer");
    else if (key === "gc") {
      const data = decryptProjectData(unquote(value));
      if (data && data.length >= 1) lockedForViewing = data[0] === 0x00;
    } else if (key === "dpb") {
      const data = decryptProjectData(unquote(value));
      if (data) hasPassword = !(data.length === 1 && data[0] === 0x00);
    }
  }
  return { moduleKinds, lockedForViewing, hasPassword };
}

function unquote(v: string): string {
  return v.replace(/^"|"$/g, "");
}

/** 2.4.3.3 Decryption。hex 文字列を復号して Data 部分を返す。形式が不正なら null。 */
export function decryptProjectData(hex: string): Uint8Array | null {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length < 6 || hex.length % 2 !== 0) return null;
  const enc = new Uint8Array(hex.length / 2);
  for (let i = 0; i < enc.length; i++) enc[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);

  const seed = enc[0];
  const versionEnc = enc[1];
  if ((seed ^ versionEnc) !== 2) return null;
  const projKeyEnc = enc[2];
  let unencrypted1 = seed ^ projKeyEnc;
  let encrypted1 = projKeyEnc;
  let encrypted2 = versionEnc;
  let pos = 3;
  const next = (): number | null => {
    if (pos >= enc.length) return null;
    const byteEnc = enc[pos++];
    const byte = (byteEnc ^ ((encrypted2 + unencrypted1) & 0xff)) & 0xff;
    encrypted2 = encrypted1;
    encrypted1 = byteEnc;
    unencrypted1 = byte;
    return byte;
  };

  const ignored = (seed & 6) / 2;
  for (let i = 0; i < ignored; i++) if (next() === null) return null;
  let length = 0;
  for (let i = 0; i < 4; i++) {
    const b = next();
    if (b === null) return null;
    length += b * 256 ** i;
  }
  if (length > enc.length) return null;
  const data = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    const b = next();
    if (b === null) return null;
    data[i] = b;
  }
  return data;
}
