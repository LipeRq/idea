// VBAソースの字句レベルの解析: 論理行、プロシージャ、Declare文、エラー処理の有無。
import type { Declare, Parameter, ProcedureKind } from "../schema";

export interface LogicalLine {
  /** 1始まりの物理行番号(行継続 " _" をまたぐ場合は開始行と終了行) */
  start: number;
  end: number;
  /** コメントを除いたコード */
  code: string;
  /** code から文字列リテラルの中身を除いたもの("abc" → "") */
  bare: string;
  /** 文字列リテラルの値 */
  strings: string[];
  /** 所属するプロシージャの番号。モジュールレベルなら -1 */
  proc: number;
}

export interface ParsedProcedure {
  name: string;
  kind: ProcedureKind;
  scope: "public" | "private" | "friend";
  isStatic: boolean;
  startLine: number;
  endLine: number;
  params: Parameter[];
  returnType: string | null;
  errorHandling: "handler" | "resumeNext" | "none";
}

export interface ParsedModule {
  lines: LogicalLine[];
  procedures: ParsedProcedure[];
  declares: Declare[];
  hasOptionExplicit: boolean;
  withEvents: string[];
  /** モジュールレベルで宣言された変数・定数の名前(呼び出しの解決で、同名のプロシージャと区別する) */
  moduleVariables: string[];
  lineCount: number;
  codeLineCount: number;
  commentLineCount: number;
}

const IDENT = String.raw`[\p{L}_][\p{L}\p{N}_]*`;
const PROC_RE = new RegExp(
  String.raw`^(?:(Public|Private|Friend|Global)\s+)?(?:(Static)\s+)?(Sub|Function|Property\s+Get|Property\s+Let|Property\s+Set)\s+(${IDENT})([$%&!#@]?)\s*(.*)$`,
  "iu",
);
const DECLARE_RE = new RegExp(
  String.raw`^(?:(?:Public|Private|Global)\s+)?Declare\s+(PtrSafe\s+)?(?:Sub|Function)\s+(${IDENT})[$%&!#@]?\s+Lib\s+"([^"]*)"(?:\s+Alias\s+"([^"]*)")?`,
  "iu",
);
const END_PROC_RE = /^End\s+(Sub|Function|Property)\b/i;
const WITH_EVENTS_RE = new RegExp(String.raw`\bWithEvents\s+(${IDENT})`, "giu");
const PARAM_RE = new RegExp(
  String.raw`^(Optional\s+)?(?:(ByVal|ByRef)\s+)?(ParamArray\s+)?(${IDENT})([$%&!#@]?)\s*(\(\s*\))?\s*(?:As\s+(?:New\s+)?([\p{L}\p{N}_.]+(?:\s*\*\s*\d+)?))?\s*(?:=\s*(.+))?$`,
  "iu",
);
const SUFFIX_TYPE: Record<string, string> = {
  $: "String",
  "%": "Integer",
  "&": "Long",
  "!": "Single",
  "#": "Double",
  "@": "Currency",
};

/** VBA の行継続は 24 回まで。壊れたソースで延々とつながるのを防ぐため、これを超えたら新しい論理行にする */
const MAX_CONTINUATIONS = 64;
/** 1つの論理行として解析する最大文字数(VBE の上限は 1 行 1023 文字 × 25 行) */
const MAX_LOGICAL_LINE = 32 * 1024;

export function parseModuleSource(source: string): ParsedModule {
  const physical = source.split("\n");
  let commentLineCount = 0;
  let codeLineCount = 0;
  for (const raw of physical) {
    const t = raw.trim();
    if (t === "") continue;
    if (t.startsWith("'") || /^Rem(\s|$)/i.test(t)) commentLineCount++;
    else codeLineCount++;
  }

  const lines: LogicalLine[] = [];
  for (let i = 0; i < physical.length; i++) {
    const start = i;
    let text = physical[i];
    let joined = 0;
    while (joined < MAX_CONTINUATIONS && text.length < MAX_LOGICAL_LINE && /(^|\s)_\s*$/.test(text) && i + 1 < physical.length) {
      text = text.replace(/_\s*$/, "") + " " + physical[++i].trimStart();
      joined++;
    }
    const { code, bare, strings } = splitCode(text.length > MAX_LOGICAL_LINE ? text.slice(0, MAX_LOGICAL_LINE) : text);
    lines.push({ start: start + 1, end: i + 1, code, bare, strings, proc: -1 });
  }

  const procedures: ParsedProcedure[] = [];
  const declares: Declare[] = [];
  let hasOptionExplicit = false;
  const withEvents: string[] = [];
  const moduleVariables: string[] = [];
  let current: ParsedProcedure | null = null;
  let flags = { handler: false, resumeNext: false };
  // 条件付きコンパイル(#If VBA7 Then ... #Else ... #End If)。64ビット版で読まれない分岐かどうかを追う
  const branches: { seenPositive: boolean; legacy: boolean }[] = [];

  const close = (endLine: number) => {
    if (!current) return;
    current.endLine = endLine;
    current.errorHandling = flags.handler ? "handler" : flags.resumeNext ? "resumeNext" : "none";
    procedures.push(current);
    current = null;
  };

  for (const line of lines) {
    const code = line.code.replace(/^\d+\s+/, "");
    const directive = /^#\s*(If|ElseIf|Else|End\s*If)\b\s*(.*?)(?:\s+Then)?\s*$/i.exec(code);
    if (directive) {
      const kind = directive[1].toLowerCase().replace(/\s+/g, "");
      const cond = directive[2];
      const top = branches[branches.length - 1];
      if (kind === "if") branches.push({ seenPositive: isWin64Condition(cond), legacy: isNotWin64Condition(cond) });
      else if (kind === "elseif" && top) {
        top.legacy = top.seenPositive || isNotWin64Condition(cond);
        top.seenPositive ||= isWin64Condition(cond);
      } else if (kind === "else" && top) top.legacy = top.seenPositive;
      else if (kind === "endif") branches.pop();
      continue;
    }
    if (!current) {
      if (/^Option\s+Explicit\b/i.test(code)) hasOptionExplicit = true;
      for (const m of line.bare.matchAll(WITH_EVENTS_RE)) withEvents.push(m[1]);
      const d = DECLARE_RE.exec(code);
      if (d) {
        declares.push({
          name: d[2],
          lib: d[3],
          alias: d[4] ?? null,
          ptrSafe: Boolean(d[1]),
          line: line.start,
          legacyBranch: branches.some((b) => b.legacy),
        });
        continue;
      }
      const header = parseProcedureHeader(code, line.start);
      if (header) {
        current = header;
        flags = { handler: false, resumeNext: false };
        line.proc = procedures.length;
        // 1行で書かれたプロシージャ(Sub A(): MsgBox 1: End Sub)
        if (/:\s*End\s+(Sub|Function|Property)\s*$/i.test(line.bare)) close(line.end);
        continue;
      }
      moduleVariables.push(...declaredNames(line.bare, true));
      continue;
    }

    line.proc = procedures.length;
    if (END_PROC_RE.test(code)) {
      close(line.end);
      continue;
    }
    if (/\bOn\s+Error\s+GoTo\s+(?!0\b)[\p{L}\p{N}_]+/iu.test(line.bare)) flags.handler = true;
    if (/\bOn\s+Error\s+Resume\s+Next\b/i.test(line.bare)) flags.resumeNext = true;
    // End が無いまま次の宣言が始まった場合(壊れたソース)は直前で閉じる
    const next = parseProcedureHeader(code, line.start);
    if (next) {
      close(line.start - 1);
      current = next;
      flags = { handler: false, resumeNext: false };
      line.proc = procedures.length;
    }
  }
  close(physical.length);

  return {
    lines,
    procedures,
    declares,
    hasOptionExplicit,
    withEvents,
    moduleVariables,
    lineCount: physical.length === 1 && physical[0] === "" ? 0 : physical.length,
    codeLineCount,
    commentLineCount,
  };
}

const isWin64Condition = (cond: string) => /^\(?\s*(VBA7|Win64)\s*\)?$/i.test(cond.trim());
const isNotWin64Condition = (cond: string) => /^Not\s+\(?\s*(VBA7|Win64)\s*\)?$/i.test(cond.trim());

const DECLARATION_RE = /^(?:(?:Public|Private|Global|Friend)\s+)?(?:(Dim|Static|Const|ReDim(?:\s+Preserve)?|Public|Private|Global)\s+)(?:(?:Const|WithEvents|Shared)\s+)?(.+)$/i;
const NOT_VARIABLE_RE = /^(?:(?:Public|Private|Global|Friend)\s+)?(?:Declare|Sub|Function|Property|Enum|Type|Event|Implements)\b/i;
const LEADING_IDENT_RE = new RegExp(String.raw`^\s*(${IDENT})`, "u");

/**
 * Dim / Private / Const などの宣言文で宣言される名前を返す(Dim a As Long, b(1 To 3) As String → a, b)。
 * moduleLevel が false のときは手続き内の宣言(Dim / Static / Const / ReDim)だけを見る。
 */
export function declaredNames(bare: string, moduleLevel: boolean): string[] {
  if (NOT_VARIABLE_RE.test(bare)) return [];
  const m = DECLARATION_RE.exec(bare);
  if (!m) return [];
  if (!moduleLevel && !/^(Dim|Static|Const|ReDim)/i.test(m[1])) return [];
  const names: string[] = [];
  let depth = 0;
  let part = "";
  for (const c of m[2]) {
    if (c === "(") depth++;
    else if (c === ")") depth--;
    if (c === "," && depth === 0) {
      const n = LEADING_IDENT_RE.exec(part);
      if (n) names.push(n[1]);
      part = "";
      continue;
    }
    part += c;
  }
  const n = LEADING_IDENT_RE.exec(part);
  if (n) names.push(n[1]);
  return names;
}

function parseProcedureHeader(code: string, line: number): ParsedProcedure | null {
  const m = PROC_RE.exec(code);
  if (!m) return null;
  const kindWord = m[3].toLowerCase().replace(/\s+/g, " ");
  const kind: ProcedureKind =
    kindWord === "sub"
      ? "sub"
      : kindWord === "function"
        ? "function"
        : kindWord === "property get"
          ? "propertyGet"
          : kindWord === "property let"
            ? "propertyLet"
            : "propertySet";

  let rest = m[6].trim();
  let params: Parameter[] = [];
  if (rest.startsWith("(")) {
    const close = matchingParen(rest, 0);
    params = parseParams(rest.slice(1, close));
    rest = rest.slice(close + 1).trim();
  }
  const asType = /^As\s+(.+)$/i.exec(rest);
  const returnType =
    kind === "function" || kind === "propertyGet"
      ? (asType?.[1].trim() ?? SUFFIX_TYPE[m[5]] ?? "Variant")
      : null;
  const scopeWord = (m[1] ?? "public").toLowerCase();
  return {
    name: m[4],
    kind,
    scope: scopeWord === "private" ? "private" : scopeWord === "friend" ? "friend" : "public",
    isStatic: Boolean(m[2]),
    startLine: line,
    endLine: line,
    params,
    returnType,
    errorHandling: "none",
  };
}

function matchingParen(s: string, open: number): number {
  let depth = 0;
  let inString = false;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '"') inString = !inString;
    if (inString) continue;
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i;
  }
  return s.length;
}

export function parseParams(s: string): Parameter[] {
  const parts: string[] = [];
  let depth = 0;
  let inString = false;
  let buf = "";
  for (const c of s) {
    if (c === '"') inString = !inString;
    if (!inString) {
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (c === "," && depth === 0) {
        parts.push(buf);
        buf = "";
        continue;
      }
    }
    buf += c;
  }
  if (buf.trim()) parts.push(buf);

  return parts.map((p) => {
    const text = p.trim();
    const m = PARAM_RE.exec(text);
    if (!m) {
      return { name: text, type: null, byVal: false, optional: false, paramArray: false, isArray: false, defaultValue: null };
    }
    return {
      name: m[4],
      type: m[7] ?? SUFFIX_TYPE[m[5]] ?? null,
      byVal: (m[2] ?? "").toLowerCase() === "byval",
      optional: Boolean(m[1]),
      paramArray: Boolean(m[3]),
      isArray: Boolean(m[6]),
      defaultValue: m[8]?.trim() ?? null,
    };
  });
}

/** 1つの論理行をコード・文字列リテラル・コメントに分ける */
export function splitCode(text: string): { code: string; bare: string; strings: string[] } {
  if (/^\s*(\d+\s+)?Rem(\s|$)/i.test(text)) return { code: "", bare: "", strings: [] };
  let code = "";
  let bare = "";
  const strings: string[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "'") break;
    if (c === '"') {
      let value = "";
      i++;
      while (i < text.length) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') {
            value += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        value += text[i++];
      }
      strings.push(value);
      code += `"${value.replace(/"/g, '""')}"`;
      bare += '""';
      continue;
    }
    code += c;
    bare += c;
    i++;
  }
  return { code: code.trim(), bare: bare.trim(), strings };
}
