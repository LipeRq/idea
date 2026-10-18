// コードページ(Windows の ANSI コードページ番号)に従った文字列のデコード。
// ブラウザでも動くように、iconv-lite ではなく標準の TextDecoder(WHATWG Encoding)を使う。
// Node.js(ICU)の TextDecoder には次の癖があるため補正している(ブラウザは WHATWG どおりなので補正不要):
// - windows-1252 が ISO-8859-1 として扱われ、0x80〜0x9F(€ “ ” など)が制御文字になる → 自前の表で変換する
// - shift_jis で 0x1A / 0x1C / 0x7F が入れ替わった制御文字になる → 起動時に検出して戻す

/** VBA の PROJECTCODEPAGE → WHATWG Encoding のラベル */
const LABELS: Record<number, string> = {
  874: "windows-874",
  932: "shift_jis",
  936: "gbk",
  949: "euc-kr",
  950: "big5",
  1250: "windows-1250",
  1251: "windows-1251",
  1253: "windows-1253",
  1254: "windows-1254",
  1255: "windows-1255",
  1256: "windows-1256",
  1257: "windows-1257",
  1258: "windows-1258",
  866: "ibm866",
  10000: "macintosh",
  10007: "x-mac-cyrillic",
  20866: "koi8-r",
  21866: "koi8-u",
  28592: "iso-8859-2",
  28595: "iso-8859-5",
  28597: "iso-8859-7",
  50220: "iso-2022-jp",
  51932: "euc-jp",
  54936: "gb18030",
  65001: "utf-8",
  1200: "utf-16le",
  1201: "utf-16be",
};

/** 自前で変換するコードページ(1252 / Latin-1 / ASCII) */
const BUILTIN = new Set([1252, 20127, 28591]);

/** レポートの encoding 欄に出す名前(以前の iconv-lite の名前に合わせる) */
const NAMES: Record<number, string> = {
  1200: "utf16le",
  1201: "utf16be",
  65001: "utf8",
  20127: "ascii",
  28591: "latin1",
  10000: "macroman",
};

interface Decoder {
  decode(input: Uint8Array): string;
}

const decoders = new Map<string, Decoder | null>();

function decoderFor(label: string): Decoder | null {
  if (!decoders.has(label)) {
    try {
      decoders.set(label, new TextDecoder(label));
    } catch {
      decoders.set(label, null); // この実行環境では未対応(ICU を小さくした Node.js など)
    }
  }
  return decoders.get(label)!;
}

/** Windows のコードページ番号をエンコーディング名に変換する。この環境で読めないコードページなら null。 */
export function encodingForCodePage(codePage: number): string | null {
  if (BUILTIN.has(codePage)) return NAMES[codePage] ?? `cp${codePage}`;
  const label = LABELS[codePage];
  if (!label || !decoderFor(label)) return null;
  return NAMES[codePage] ?? `cp${codePage}`;
}

// cp1252 の 0x80〜0x9F(未定義の位置は U+FFFD)
const CP1252_HIGH = [
  0x20ac, 0xfffd, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0xfffd, 0x017d, 0xfffd,
  0xfffd, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0xfffd, 0x017e, 0x0178,
];

function decodeSingleByte(bytes: Uint8Array, codePage: number): string {
  let out = "";
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const end = Math.min(bytes.length, i + CHUNK);
    const codes = new Array<number>(end - i);
    for (let j = i; j < end; j++) {
      const b = bytes[j];
      codes[j - i] = codePage === 1252 && b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80] : codePage === 20127 && b >= 0x80 ? 0xfffd : b;
    }
    out += String.fromCharCode(...codes);
  }
  return out;
}

/** ICU の shift_jis が制御文字を入れ替える癖があるか(Node.js)を一度だけ調べる */
let sjisControlQuirk: boolean | null = null;
function hasSjisControlQuirk(d: Decoder): boolean {
  if (sjisControlQuirk === null) sjisControlQuirk = d.decode(Uint8Array.of(0x1a)) !== "\u001a";
  return sjisControlQuirk;
}
const SJIS_FIX: Record<string, string> = { "\u001c": "\u001a", "\u007f": "\u001c", "\u001a": "\u007f" };

/** MBCS 文字列をコードページに従ってデコードする。未対応のコードページは cp1252 で読む。 */
export function decodeText(bytes: Uint8Array, codePage: number): string {
  if (BUILTIN.has(codePage)) return decodeSingleByte(bytes, codePage);
  const label = LABELS[codePage];
  const d = label ? decoderFor(label) : null;
  if (!d) return decodeSingleByte(bytes, 1252);
  const text = d.decode(bytes);
  if (codePage === 932 && hasSjisControlQuirk(d)) return text.replace(/[\u001a\u001c\u007f]/g, (c: string) => SJIS_FIX[c]);
  return text;
}

export function decodeUtf16(bytes: Uint8Array): string {
  return decoderFor("utf-16le")!.decode(bytes);
}
