// 取り出したVBAソースから、プロシージャ・呼び出し関係・外部依存・起動のきっかけを組み立てる。
import type {
  CallEdge,
  Dependency,
  EntryPoint,
  ModuleType,
  Procedure,
  VbaModule,
  VbaProject,
  VbaReference,
} from "../schema";
import { detectEvent } from "./events";
import { parseModuleSource, type LogicalLine, type ParsedModule } from "./parse";
import { hasCredentials, maskSecrets, maskSecretsInSource } from "../secrets";
import type { RawVbaProject } from "./project";

export interface VbaAnalysis {
  project: VbaProject;
  callGraph: CallEdge[];
  dependencies: Dependency[];
  entryPoints: EntryPoint[];
}

export interface VbaAnalysisOptions {
  host: "excel" | "access";
  includeSource: boolean;
  /** シートのコード名(Sheet1)→ シート名(売上) */
  sheetNames?: Map<string, string>;
}

interface ModuleContext {
  name: string;
  type: ModuleType;
  parsed: ParsedModule;
  procedures: Procedure[];
}

const IDENT = String.raw`[\p{L}_][\p{L}\p{N}_]*`;
const CHAIN_RE = new RegExp(String.raw`([.!]\s*)?(${IDENT}(?:\s*\.\s*${IDENT})*)`, "gu");

export function analyzeVbaProject(raw: RawVbaProject, options: VbaAnalysisOptions): VbaAnalysis {
  const contexts: ModuleContext[] = raw.modules.map((m) => {
    const parsed = parseModuleSource(m.source);
    const sheetLabel = options.sheetNames?.get(m.name.toLowerCase());
    const procedures = parsed.procedures.map((p): Procedure => {
      const event = detectEvent(p.name, m.name, m.type, parsed.withEvents, sheetLabel);
      return {
        id: `${m.name}.${p.name}`,
        name: p.name,
        kind: p.kind,
        scope: p.scope,
        isStatic: p.isStatic,
        startLine: p.startLine,
        endLine: p.endLine,
        lineCount: p.endLine - p.startLine + 1,
        params: p.params,
        returnType: p.returnType,
        errorHandling: p.errorHandling,
        isEvent: event !== null,
        eventLabel: event?.label ?? null,
        calls: [],
        calledBy: [],
      };
    });
    return { name: m.name, type: m.type, parsed, procedures };
  });

  const resolver = new Resolver(contexts, raw.name);
  const edges = new Map<string, CallEdge>();
  const addEdge = (edge: CallEdge) => {
    if (edge.from === edge.to) return;
    const key = `${edge.from}\u0000${edge.to}\u0000${edge.kind}`;
    if (!edges.has(key)) edges.set(key, edge);
  };
  const dependencies: Dependency[] = [];
  const entryPoints: EntryPoint[] = [];

  for (const ctx of contexts) {
    for (const p of ctx.procedures) {
      // クラスのイベント(Class_Initialize 等)はコードから New されたときに動くので起動経路には含めない
      if (!p.isEvent || ctx.type === "class") continue;
      const auto = ctx.type === "standard";
      entryPoints.push({
        kind: auto ? "autoMacro" : "event",
        trigger: p.eventLabel ?? p.name,
        procedure: p.id,
        target: p.name,
        location: { module: ctx.name, procedure: p.name, line: p.startLine },
      });
    }

    for (const line of ctx.parsed.lines) {
      const proc = line.proc >= 0 ? ctx.procedures[line.proc] : null;
      const location = { module: ctx.name, procedure: proc?.name, line: line.start };
      dependencies.push(...scanDependencies(line, location));
      if (!proc || line.start === proc.startLine) continue;

      const locals = localNames(ctx.parsed.procedures[line.proc].params.map((x) => x.name), line);
      for (const m of line.bare.matchAll(CHAIN_RE)) {
        if (m[1]) continue; // With ブロック内の .Member や Me!Field
        const parts = m[2].split(".").map((s) => s.trim());
        if (parts.length === 1 && (locals.has(parts[0].toLowerCase()) || parts[0].toLowerCase() === proc.name.toLowerCase())) {
          continue;
        }
        const target = resolver.resolveChain(parts, ctx);
        if (target) addEdge({ from: proc.id, to: target.id, kind: target.kind, line: line.start });
      }

      for (const dyn of dynamicCalls(line)) {
        const resolved = resolver.resolveMacroName(dyn.macro, ctx);
        if (dyn.kind === "schedule" || dyn.kind === "shortcut") {
          entryPoints.push({
            kind: dyn.kind,
            trigger: dyn.trigger,
            procedure: resolved,
            target: dyn.macro,
            location,
          });
        }
        if (resolved) addEdge({ from: proc.id, to: resolved, kind: "run", line: line.start });
      }
      for (const form of accessOpens(line)) {
        const mod = resolver.moduleByName(form);
        if (mod) addEdge({ from: proc.id, to: mod.name, kind: "formShow", line: line.start });
      }
    }

    for (const d of ctx.parsed.declares) {
      dependencies.push({
        kind: "winApi",
        target: `${d.lib}: ${d.alias ?? d.name}`,
        category: d.ptrSafe ? "PtrSafe" : "PtrSafe なし",
        location: { module: ctx.name, line: d.line },
      });
    }
  }

  const callGraph = [...edges.values()];
  const byId = new Map(contexts.flatMap((c) => c.procedures.map((p) => [p.id, p] as const)));
  for (const e of callGraph) {
    const from = byId.get(e.from);
    if (from && !from.calls.includes(e.to)) from.calls.push(e.to);
    const to = byId.get(e.to);
    if (to && !to.calledBy.includes(e.from)) to.calledBy.push(e.from);
  }

  for (const ref of raw.references) {
    dependencies.push({
      kind: "reference",
      target: ref.description ?? ref.name,
      category: isStandardReference(ref, options.host) ? "標準" : "追加",
      location: { part: "VBA参照設定" },
    });
  }

  const modules: VbaModule[] = contexts.map((ctx, i) => ({
    name: ctx.name,
    streamName: raw.modules[i].streamName,
    type: ctx.type,
    lineCount: ctx.parsed.lineCount,
    codeLineCount: ctx.parsed.codeLineCount,
    commentLineCount: ctx.parsed.commentLineCount,
    hasOptionExplicit: ctx.parsed.hasOptionExplicit,
    procedures: ctx.procedures,
    declares: ctx.parsed.declares,
    source: options.includeSource ? maskSecretsInSource(raw.modules[i].source) : null,
  }));

  return {
    project: {
      name: raw.name,
      codePage: raw.codePage,
      encoding: raw.encoding,
      lockedForViewing: raw.lockedForViewing,
      hasPassword: raw.hasPassword,
      references: raw.references,
      modules,
    },
    callGraph,
    dependencies,
    entryPoints,
  };
}

class Resolver {
  private modules = new Map<string, ModuleContext>();
  private procsByModule = new Map<string, Map<string, Procedure>>();
  private globals = new Map<string, Procedure[]>();
  private projectName: string;

  constructor(contexts: ModuleContext[], projectName: string) {
    this.projectName = projectName.toLowerCase();
    for (const ctx of contexts) {
      const key = ctx.name.toLowerCase();
      this.modules.set(key, ctx);
      const procs = new Map<string, Procedure>();
      for (const p of ctx.procedures) {
        const lower = p.name.toLowerCase();
        if (!procs.has(lower)) procs.set(lower, p);
        if (ctx.type === "standard" && p.scope !== "private") {
          const list = this.globals.get(lower) ?? [];
          if (!list.some((x) => x.id === p.id)) list.push(p);
          this.globals.set(lower, list);
        }
      }
      this.procsByModule.set(key, procs);
    }
  }

  moduleByName(name: string): ModuleContext | undefined {
    return this.modules.get(name.toLowerCase());
  }

  resolveChain(parts: string[], ctx: ModuleContext): { id: string; kind: CallEdge["kind"] } | null {
    let rest = parts;
    if (rest.length > 2 && rest[0].toLowerCase() === this.projectName) rest = rest.slice(1);
    if (rest.length === 1) {
      const p = this.lookup(ctx.name, rest[0]) ?? this.global(rest[0]);
      return p ? { id: p.id, kind: "call" } : null;
    }
    const q = rest[0].toLowerCase();
    if (q === "me") {
      const p = this.lookup(ctx.name, rest[1]);
      return p ? { id: p.id, kind: "call" } : null;
    }
    const mod = this.modules.get(q);
    if (!mod) return null;
    const p = this.lookup(mod.name, rest[1]);
    if (p) return { id: p.id, kind: "call" };
    if (mod.type === "form" && rest[1].toLowerCase() === "show") return { id: mod.name, kind: "formShow" };
    return null;
  }

  /** Application.Run や OnAction に書かれたマクロ名("'Book.xlsm'!Module1.Proc" など)を解決する */
  resolveMacroName(macro: string, ctx: ModuleContext): string | null {
    const name = macro.replace(/^(?:'[^']*'|[^!'"]*)!/, "").trim();
    const parts = name.split(".").map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return null;
    if (parts.length === 1) return (this.global(parts[0]) ?? this.lookup(ctx.name, parts[0]))?.id ?? null;
    return this.lookup(parts[parts.length - 2], parts[parts.length - 1])?.id ?? null;
  }

  private lookup(moduleName: string, procName: string): Procedure | undefined {
    return this.procsByModule.get(moduleName.toLowerCase())?.get(procName.toLowerCase());
  }

  private global(procName: string): Procedure | undefined {
    return this.globals.get(procName.toLowerCase())?.[0];
  }
}

function localNames(params: string[], line: LogicalLine): Set<string> {
  const names = new Set(params.map((p) => p.toLowerCase()));
  const m = /^(?:Dim|Static|Const|ReDim(?:\s+Preserve)?)\s+(.+)$/i.exec(line.bare);
  if (m) {
    for (const part of m[1].split(",")) {
      const n = new RegExp(`^\\s*(${IDENT})`, "u").exec(part);
      if (n) names.add(n[1].toLowerCase());
    }
  }
  return names;
}

interface DynamicCall {
  kind: "run" | "schedule" | "shortcut";
  macro: string;
  trigger: string;
}

function dynamicCalls(line: LogicalLine): DynamicCall[] {
  const result: DynamicCall[] = [];
  const code = line.code;
  for (const m of code.matchAll(/(?<![\p{L}\p{N}_])Run\s*\(?\s*"([^"]+)"/giu)) {
    result.push({ kind: "run", macro: m[1], trigger: "" });
  }
  for (const m of code.matchAll(/\.OnAction\s*=\s*"([^"]+)"/gi)) {
    result.push({ kind: "run", macro: m[1], trigger: "" });
  }
  const onTime = /\bOnTime\b(.*)$/i.exec(code);
  if (onTime) {
    const literal = /(?:Procedure\s*:=\s*|,\s*)"([^"]+)"/i.exec(onTime[1]);
    if (literal) result.push({ kind: "schedule", macro: literal[1], trigger: "時刻を指定して実行(Application.OnTime)" });
  }
  const onKey = /\bOnKey\s*\(?\s*"([^"]*)"\s*,\s*"([^"]+)"/i.exec(code);
  if (onKey) result.push({ kind: "shortcut", macro: onKey[2], trigger: `キー「${onKey[1]}」を押したとき(Application.OnKey)` });
  return result;
}

/** Access の DoCmd.OpenForm "frmX" / DoCmd.OpenReport "rptX" から開くフォームのモジュール名を返す */
function accessOpens(line: LogicalLine): string[] {
  const result: string[] = [];
  for (const m of line.code.matchAll(/\bDoCmd\s*\.\s*Open(Form|Report)\s*\(?\s*"([^"]+)"/gi)) {
    result.push(`${m[1].toLowerCase() === "form" ? "Form" : "Report"}_${m[2]}`);
  }
  return result;
}

const PATH_RE = /^(?:[A-Za-z]:\\|\\\\[^\\]+\\)/;
const EMBEDDED_PATH_RE = /(?:\b[A-Za-z]:\\|\\\\[^\\\s]+\\)[^\s"*?<>|]*/;
const pathCategory = (s: string) => (s.startsWith("\\\\") ? "ネットワーク共有" : "ローカルドライブ");
const FILE_EXT_RE = /\.(xlsx|xlsm|xlsb|xlam|xls|csv|txt|tsv|mdb|accdb|pdf|docx|doc|xml|json|ini|log|dat)$/i;
const CONN_RE = /\b(Provider|Driver|DSN|Data Source|DBQ|Initial Catalog)\s*=/i;
const SQL_RE = /^\s*(SELECT|INSERT\s+INTO|UPDATE\s+\S+\s+SET|DELETE\s+(?:\*\s+)?FROM|CREATE\s+TABLE|DROP\s+TABLE|ALTER\s+TABLE|TRUNCATE|EXEC(?:UTE)?)\b/i;

const PROGID_CATEGORIES: [RegExp, string][] = [
  [/^(ADODB|ADOX|DAO|ADOMD)\./i, "データベース接続"],
  [/^Scripting\.FileSystemObject$/i, "ファイル操作"],
  [/^Scripting\.Dictionary$/i, "Scripting Runtime(Dictionary)"],
  [/^(WScript\.Shell|Shell\.Application|WScript\.Network)$/i, "外部プログラム・OS操作"],
  [/^(Outlook\.|CDO\.|Redemption\.)/i, "メール送信"],
  [/(XMLHTTP|WinHttp)/i, "HTTP通信"],
  [/^InternetExplorer\.Application/i, "Internet Explorer 自動操作(サポート終了)"],
  [/^(Excel|Word|PowerPoint|Access|Visio|Publisher|Outlook)\.Application$/i, "Office連携"],
  [/^VBScript\.RegExp$/i, "正規表現"],
  [/^(MSXML2\.DOMDocument|Microsoft\.XMLDOM)/i, "XML処理"],
  [/^Selenium\./i, "ブラウザ自動操作(Selenium)"],
];

const BARE_CLASSES: Record<string, string> = {
  filesystemobject: "Scripting.FileSystemObject",
  dictionary: "Scripting.Dictionary",
  regexp: "VBScript.RegExp",
  xmlhttp60: "MSXML2.XMLHTTP60",
  serverxmlhttp60: "MSXML2.ServerXMLHTTP60",
  winhttprequest: "WinHttp.WinHttpRequest",
  internetexplorer: "InternetExplorer.Application",
  internetexplorermedium: "InternetExplorer.Application",
};

const NEW_RE = new RegExp(String.raw`\bNew\s+(${IDENT}(?:\.${IDENT})?)`, "giu");

export function categorizeProgId(progId: string): string {
  return PROGID_CATEGORIES.find(([re]) => re.test(progId))?.[1] ?? "COMオブジェクト";
}

function scanDependencies(line: LogicalLine, location: Dependency["location"]): Dependency[] {
  const deps: Dependency[] = [];
  const add = (kind: Dependency["kind"], target: string, category: string | null = null) =>
    deps.push({ kind, target, category, location });
  const firstLiteral = () => line.strings.find((s) => s.trim() !== "") ?? "(変数で指定)";
  const pathLiteral = () =>
    line.strings.find((s) => PATH_RE.test(s) || EMBEDDED_PATH_RE.test(s) || FILE_EXT_RE.test(s.trim())) ?? firstLiteral();

  for (const s of line.strings) {
    if (CONN_RE.test(s)) add("connectionString", maskSecrets(s), hasCredentials(s) ? "認証情報を含む" : null);
    else if (SQL_RE.test(s)) add("sql", s.trim());
    else if (/^(https?|ftp):\/\//i.test(s)) add("url", s);
    else if (PATH_RE.test(s)) add("filePath", s, pathCategory(s));
    else if (EMBEDDED_PATH_RE.test(s)) {
      for (const m of s.matchAll(new RegExp(EMBEDDED_PATH_RE, "g"))) add("filePath", m[0], pathCategory(m[0]));
    } else if (FILE_EXT_RE.test(s.trim()) && !/\s/.test(s.trim())) add("filePath", s, "ファイル名");
  }

  const code = line.code;
  for (const m of code.matchAll(/\bCreateObject\s*\(\s*("([^"]*)"|[^,)]*)/gi)) {
    const progId = m[2] ?? "(変数で指定)";
    add("createObject", progId, m[2] ? categorizeProgId(progId) : null);
  }
  for (const m of code.matchAll(/\bGetObject\s*\(\s*("([^"]*)")?\s*(?:,\s*"([^"]*)")?/gi)) {
    if (m[2] && (PATH_RE.test(m[2]) || FILE_EXT_RE.test(m[2]))) add("workbook", m[2], "GetObject");
    else if (m[3]) add("createObject", m[3], categorizeProgId(m[3]));
  }
  // 参照設定を使った生成(New ADODB.Connection、New FileSystemObject など)。自作クラスの New は対象外
  for (const m of line.bare.matchAll(NEW_RE)) {
    const progId = m[1].includes(".") ? m[1] : BARE_CLASSES[m[1].toLowerCase()];
    if (progId && PROGID_CATEGORIES.some(([re]) => re.test(progId))) {
      add("createObject", progId, `${categorizeProgId(progId)}(参照設定)`);
    }
  }

  const bare = line.bare;
  const isDeclaration = /^(Dim|Private|Public|Static|Global|Const)\b/i.test(bare);
  if (!isDeclaration && /(?<![.\p{L}\p{N}_])Shell\s*(\(|\s+[^=\s])/iu.test(bare)) add("shell", firstLiteral());
  if (/\bSendKeys\b/i.test(bare)) add("sendKeys", line.strings[0] ?? "");
  const wb = /\bWorkbooks\s*\.\s*(Open|OpenText|OpenXML)\b/i.exec(bare);
  if (wb) add("workbook", pathLiteral(), `Workbooks.${wb[1]}`);
  const open = /\bOpen\s+.+?\s+For\s+(Input|Output|Append|Binary|Random)\b/i.exec(bare);
  if (open) add("fileIo", pathLiteral(), `Open ... For ${open[1]}`);
  const fileCmd = /(?<![.\p{L}\p{N}_])(Kill|FileCopy|MkDir|RmDir)\b/iu.exec(bare);
  if (fileCmd) add("fileIo", pathLiteral(), fileCmd[1]);
  const docmd = /\bDoCmd\s*\.\s*(TransferSpreadsheet|TransferText|TransferDatabase|OutputTo|ImportXML|ExportXML)\b/i.exec(bare);
  if (docmd) add("fileIo", pathLiteral(), `DoCmd.${docmd[1]}`);
  const save = /\.(SaveAs|SaveCopyAs|ExportAsFixedFormat)\b/i.exec(bare);
  if (save) add("fileIo", pathLiteral(), save[1]);
  if (/\bEnviron\$?\s*\(/i.test(bare)) add("environment", line.strings[0] ?? "(変数で指定)");
  if (/\.PrintOut\b/i.test(bare)) add("print", "PrintOut");
  return deps;
}

const STANDARD_REFS = ["vba", "excel", "stdole", "office", "msforms"];

function isStandardReference(ref: VbaReference, host: "excel" | "access"): boolean {
  const name = ref.name.toLowerCase();
  if (STANDARD_REFS.includes(name)) return true;
  return host === "access" && (name === "access" || name === "dao");
}
