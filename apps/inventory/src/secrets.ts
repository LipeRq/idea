// 接続文字列・ソースコードに含まれるパスワードの検出と伏せ字。
// JSON・仕様書・AI への入力のすべてに伏せ字にした後の文字列だけが流れるように、取り出した直後に適用する。

export const MASK = "****";

/** Password= / Pwd= の値(; ] 改行まで。引用符・{} で囲まれた値は閉じるまで) */
const KEY_VALUE_RE = /((?:Password|Pwd)\s*=\s*)("[^"]*"|'[^']*'|\{[^}]*\}|[^;\]\r\n]*)/gi;
/** URL の利用者情報(https://user:pass@host)のパスワード部分 */
const URL_USERINFO_RE = /(\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@"'<>]+:)([^@\s/"'<>]+)@/gi;

/** 空・引用符だけの値(Password=; や Password='')は伏せない(パスワードが無いことを示す情報なので) */
function isRealValue(value: string): boolean {
  return /[^\s'"{}]/.test(value) && value.trim() !== MASK;
}

/** 接続文字列などの Password= / Pwd= の値と URL のパスワードを **** に置き換える */
export function maskSecrets(text: string): string {
  return text
    .replace(KEY_VALUE_RE, (all, key: string, value: string) => (isRealValue(value) ? key + MASK : all))
    .replace(URL_USERINFO_RE, (all, head: string, pass: string) => (pass === MASK ? all : `${head}${MASK}@`));
}

/** 接続文字列に(空でない)パスワードが書かれているか。伏せ字にした後の文字列でも判定できる */
export function hasCredentials(text: string): boolean {
  for (const m of text.matchAll(KEY_VALUE_RE)) {
    if (/[^\s'"{}]/.test(m[2])) return true;
  }
  return new RegExp(URL_USERINFO_RE.source, "i").test(text);
}

// ---- VBA のソースコード ----

/** パスワードらしい名前の変数・プロパティ(strPassword、DB_PASS、pwd、.Password、パスワード など) */
const PASSWORD_NAME = String.raw`[\p{L}\p{N}_]*(?:pass|pwd|パスワード|暗証)[\p{L}\p{N}_]*|[\p{L}\p{N}_]*pw`;
/** 文字列リテラルの直前のコードがこれで終わっていたら、そのリテラル全体を伏せる */
const BEFORE_SECRET_LITERAL = [
  // 名前付き引数: Workbooks.Open fn, Password:="abc" / ws.Protect Password:="1234"
  new RegExp(String.raw`(?:${PASSWORD_NAME})\s*:=\s*$`, "iu"),
  // 代入・比較・定数: Const DB_PASS As String = "abc" / .Password = "abc" / If pwd = "abc" Then
  new RegExp(String.raw`(?<![\p{L}\p{N}_])(?:${PASSWORD_NAME})(?:\s*\([^()]*\))?(?:\s+As\s+[\p{L}\p{N}_.]+)?\s*(?:=|<>)\s*$`, "iu"),
  // シート・ブックの保護: ws.Protect "1234" / ActiveSheet.Unprotect("1234")
  /\b(?:Protect|Unprotect|ProtectSharing|UnprotectSharing)\s*\(?\s*$/i,
];
const QUICK_CHECK_RE = /pass|pwd|pw\b|パスワード|暗証|protect|net\s+use|:\/\//i;

export interface MaskedSource {
  source: string;
  /** パスワードらしい値を伏せた行(1始まり。コメントは除く)。リスク検出に使う */
  secretLines: number[];
}

/**
 * VBA のソース中のパスワードを伏せる。行の構造(行数・コード・コメントの位置)は変えない。
 * - 文字列リテラル内の接続文字列(Password= / Pwd=。"Jet OLEDB:Database Password=" も)と URL のパスワード
 * - "…;Password=" & "abc" のように、次のリテラルに続く値
 * - Password:="…"、パスワードらしい名前の変数・定数への代入や比較、Protect / Unprotect の引数
 * - net use のパスワード
 * - コメント中の Password=… / パスワード:… など
 * 変数への代入(Pwd = txtPwd.Value)のように、リテラルでない値はそのまま残す。
 */
export function maskVbaSource(source: string, check?: () => void): MaskedSource {
  const secretLines: number[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    check?.();
    if (!QUICK_CHECK_RE.test(lines[i])) continue;
    const { text, secret } = maskLine(lines[i]);
    lines[i] = text;
    if (secret) secretLines.push(i + 1);
  }
  return { source: lines.join("\n"), secretLines };
}

/** ソース中のパスワードを伏せる(行数は変わらない) */
export function maskSecretsInSource(source: string): string {
  return maskVbaSource(source).source;
}

interface Token {
  kind: "code" | "string";
  text: string;
  closed: boolean;
}

/** 1行をコード・文字列リテラル・コメントに分ける("" は文字列内の引用符) */
function lexLine(line: string): { tokens: Token[]; comment: string } {
  const tokens: Token[] = [];
  const rem = /^(\s*(?:\d+\s+)?)(Rem(?:\s.*)?)$/i.exec(line);
  if (rem) return { tokens: [{ kind: "code", text: rem[1], closed: true }], comment: rem[2] };
  let pos = 0;
  const special = /["']/g;
  while (pos < line.length) {
    special.lastIndex = pos;
    const m = special.exec(line);
    if (!m) {
      tokens.push({ kind: "code", text: line.slice(pos), closed: true });
      return { tokens, comment: "" };
    }
    if (m.index > pos) tokens.push({ kind: "code", text: line.slice(pos, m.index), closed: true });
    if (m[0] === "'") return { tokens, comment: line.slice(m.index) };
    // 文字列リテラル
    let j = m.index + 1;
    let closed = false;
    for (;;) {
      const q = line.indexOf('"', j);
      if (q < 0) {
        j = line.length;
        break;
      }
      if (line[q + 1] === '"') {
        j = q + 2;
        continue;
      }
      j = q;
      closed = true;
      break;
    }
    tokens.push({ kind: "string", text: line.slice(m.index + 1, j), closed });
    pos = closed ? j + 1 : j;
  }
  return { tokens, comment: "" };
}

/** 文字列リテラルの直前のコードとして見る長さ(正規表現の処理量を抑えるため末尾だけを見る) */
const CONTEXT_CHARS = 120;

function maskLine(line: string): { text: string; secret: boolean } {
  const { tokens, comment } = lexLine(line);
  let secret = false;
  let forceNext = false;
  let tail = "";
  tokens.forEach((t, i) => {
    const original = t.text;
    if (t.kind === "string") {
      const codeBefore = i > 0 && tokens[i - 1].kind === "code" ? tokens[i - 1].text : "";
      const prevLiteral = i > 1 && tokens[i - 2].kind === "string" ? tokens[i - 2].text : "";
      const value = original.replace(/""/g, '"');
      const wholeSecret =
        (QUICK_CHECK_RE.test(tail) && BEFORE_SECRET_LITERAL.some((re) => re.test(tail))) ||
        // cn.Properties("Jet OLEDB:Database Password") = "abc"
        (/^\s*\)\s*=\s*$/.test(codeBefore) && /password|pwd/i.test(prevLiteral));
      if (wholeSecret && isRealValue(value)) {
        t.text = MASK;
      } else if (forceNext && /^\s*[^;\s]/.test(value)) {
        // "…;Password=" & "abc;…" の "abc" 部分
        t.text = value.replace(/^(\s*)[^;]*/, `$1${MASK}`).replace(/"/g, '""');
      } else {
        let masked = maskSecrets(value);
        if (/\bnet\s+use\b/i.test(masked)) masked = maskNetUse(masked);
        if (masked !== value) t.text = masked.replace(/"/g, '""');
      }
      if (t.text !== original) secret = true;
      // リテラルが Password= で終わり、& で次のリテラルに続くなら、次のリテラルの先頭が値
      const next = tokens[i + 1];
      forceNext = /(?:Password|Pwd)\s*=\s*$/i.test(value) && next?.kind === "code" && /^\s*[&+]\s*$/.test(next.text) && tokens[i + 2]?.kind === "string";
    }
    tail = (tail + (t.kind === "string" ? `"${original}"` : original)).slice(-CONTEXT_CHARS);
  });
  const code = tokens.map((t) => (t.kind === "string" ? `"${t.text}${t.closed ? '"' : ""}` : t.text)).join("");
  return { text: code + maskComment(comment), secret };
}

/** net use \\server\share password /user:name の password を伏せる */
function maskNetUse(s: string): string {
  return s.replace(/(\bnet\s+use\b)(.*)$/i, (_, head: string, rest: string) => {
    let afterShare = false;
    const out = rest.replace(/(\s+)(\S+)/g, (all, sp: string, token: string) => {
      if (token.startsWith("\\\\")) {
        afterShare = true;
        return all;
      }
      if (/^\/user:/i.test(token)) {
        afterShare = true;
        return all;
      }
      if (!afterShare || token.startsWith("/") || token === "*" || token === MASK || /^[A-Z]:$/i.test(token)) return all;
      return `${sp}${MASK}`;
    });
    return head + out;
  });
}

/** コメントの中の Password=… / パスワード:… / パスワードは「…」 */
function maskComment(comment: string): string {
  if (!comment) return comment;
  return maskSecrets(comment)
    .replace(/((?:password|passwd|pwd|パスワード|暗証番号)\s*[:：＝]\s*)([^\s、。,;()()「」『』[\]]+)/giu, (all, head: string, v: string) => (v === MASK ? all : head + MASK))
    .replace(/((?:パスワード|暗証番号)\s*は\s*)([「『"'])([^」』"']+)([」』"'])/gu, (_, head: string, open: string, _v: string, close: string) => `${head}${open}${MASK}${close}`);
}
