// ファイルの外への参照(他のブック・Access・DB)の取り出しと、複数ファイルの間のつながり(関係図)。
// エンジンの実行コードには依存しない純粋な関数(Worker と画面の両方で使え、単体テストできる)。
import type { Dependency } from "@engine/browser";

export type ExternalRefKind = "book" | "access" | "database";

export const EXTERNAL_REF_KIND_LABEL: Record<ExternalRefKind, string> = {
  book: "他のブック",
  access: "Access",
  database: "DB",
};

export interface ExternalRef {
  kind: ExternalRefKind;
  /** 表示名(ファイル名、または DB のサーバー名など) */
  name: string;
  /** 元の表記(パス・接続先) */
  target: string;
  /** どのような形で参照しているか(重複なし) */
  via: string[];
  /** 参照している箇所の数 */
  count: number;
}

const VIA_LABEL: Partial<Record<Dependency["kind"], string>> = {
  workbook: "マクロで開く",
  externalLink: "数式のリンク",
  filePath: "パスを記載",
  linkedTable: "リンクテーブル",
  connectionString: "DB接続",
  dataConnection: "データ接続",
};

const BOOK_EXT = new Set([".xlsx", ".xlsm", ".xlsb", ".xlam", ".xltm", ".xls", ".xlt", ".xltx"]);
const ACCESS_EXT = new Set([".accdb", ".mdb", ".accde", ".mde"]);

/** パスから、ファイル名の部分だけを取り出す(\ と / の両方、file:/// 形式、[ブック名] 形式に対応) */
export function baseName(path: string): string {
  let s = path.trim().replace(/^file:\/+/i, "");
  try {
    if (/%[0-9a-f]{2}/i.test(s)) s = decodeURIComponent(s);
  } catch {
    // そのまま使う
  }
  s = s.replace(/[?#].*$/, "").replace(/[\]'"]+$/g, "");
  const last = s.split(/[\\/]/).pop() ?? s;
  return last.replace(/^\[/, "").trim();
}

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

/** 接続文字列から、ファイルの場所(Data Source・DBQ など)とサーバー名・DSN を取り出す */
function parseConnection(text: string): { file: string | null; server: string | null } {
  const pick = (keys: string[]) => {
    for (const key of keys) {
      const m = new RegExp(`(?:^|;)\\s*${key}\\s*=\\s*("([^"]*)"|'([^']*)'|[^;]*)`, "i").exec(text);
      const v = (m?.[2] ?? m?.[3] ?? m?.[1] ?? "").trim();
      if (v) return v;
    }
    return null;
  };
  const source = pick(["Data Source", "DBQ", "Database"]);
  const ext = source ? extOf(baseName(source)) : "";
  const file = source && (ACCESS_EXT.has(ext) || BOOK_EXT.has(ext)) ? source : null;
  const server = pick(["Server", "DSN", "Data Source", "Address", "Host"]);
  return { file, server: file ? null : server };
}

/**
 * 依存の一覧から、他のブック・Access・DB への参照を取り出す(同じ参照先は1つにまとめる)。
 * csv・txt などのファイル、URL、COM オブジェクト等は対象外(ファイルどうしのつながりではないため)。
 */
export function extractExternalRefs(deps: readonly Dependency[]): ExternalRef[] {
  const refs = new Map<string, ExternalRef>();
  const add = (kind: ExternalRefKind, name: string, target: string, via: string) => {
    const key = `${kind}\u0000${name.toLowerCase()}`;
    const found = refs.get(key);
    if (found) {
      found.count++;
      if (!found.via.includes(via)) found.via.push(via);
    } else {
      refs.set(key, { kind, name, target, via: [via], count: 1 });
    }
  };
  for (const d of deps) {
    const via = VIA_LABEL[d.kind];
    if (!via) continue;
    if (d.kind === "externalLink" && d.category && d.category !== "workbook" && d.category !== "unknown") continue;
    if (d.kind === "connectionString" || d.kind === "dataConnection" || (d.kind === "linkedTable" && /[=;]/.test(d.target))) {
      const { file, server } = parseConnection(d.target);
      if (file) {
        const name = baseName(file);
        add(ACCESS_EXT.has(extOf(name)) ? "access" : "book", name, file, via);
      } else if (server?.toLowerCase() === "$workbook$") {
        continue; // このブック自身のデータ(Power Query など)への接続
      } else {
        add("database", server ?? "(接続先を特定できません)", server ?? d.target, via);
      }
      continue;
    }
    const name = baseName(d.target);
    const ext = extOf(name);
    if (BOOK_EXT.has(ext)) add("book", name, d.target, via);
    else if (ACCESS_EXT.has(ext)) add("access", name, d.target, via);
    else if (d.kind === "linkedTable" && d.category === "odbc") add("database", name || d.target, d.target, via);
  }
  return [...refs.values()];
}

export function summarizeExternalRefs(refs: readonly ExternalRef[]): string {
  if (refs.length === 0) return "なし";
  const count = (kind: ExternalRefKind) => refs.filter((r) => r.kind === kind).length;
  return (["book", "access", "database"] as const)
    .filter((k) => count(k) > 0)
    .map((k) => `${EXTERNAL_REF_KIND_LABEL[k]} ${count(k)}`)
    .join("・");
}

// ---- 複数ファイルのつながり(関係図) ----

export interface GraphFile {
  name: string;
  kind: "excel" | "access";
  refs: readonly ExternalRef[];
}

export interface GraphNode {
  id: string;
  label: string;
  /** 解析したファイルか(false は、参照されているだけで解析していないもの) */
  analyzed: boolean;
  kind: ExternalRefKind;
}

export interface GraphEdge {
  from: string;
  to: string;
  via: string[];
}

export interface FileGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  code: string;
  /** 数が多くて図に出さなかった参照先の数 */
  omitted: number;
}

export const MAX_GRAPH_NODES = 60;

/** Mermaid のラベル(引用符・山括弧・バッククォート・改行を無害化する。エンジンの mermaidLabel と同じ) */
export function mermaidLabel(text: string): string {
  return `"${text
    .replace(/#/g, "#35;")
    .replace(/"/g, "#quot;")
    .replace(/</g, "#lt;")
    .replace(/>/g, "#gt;")
    .replace(/`/g, "#96;")
    .replace(/[\r\n]+/g, " ")}"`;
}

/**
 * 解析したファイルどうし、および解析したファイルから他のブック・Access・DB への参照を、図にする。
 * 参照が1つも無ければ null。ファイル名(大文字小文字を区別しない)で、解析したファイルと照らし合わせる。
 */
export function buildFileGraph(files: readonly GraphFile[], maxNodes = MAX_GRAPH_NODES): FileGraph | null {
  const key = (kind: ExternalRefKind, name: string) => `${kind === "database" ? "database" : "file"}:${name.toLowerCase()}`;
  const nodes = new Map<string, GraphNode>();
  const nodeFor = (k: string, label: string, analyzed: boolean, kind: ExternalRefKind): GraphNode | null => {
    let node = nodes.get(k);
    if (!node) {
      if (nodes.size >= maxNodes) return null;
      node = { id: `f${nodes.size + 1}`, label, analyzed, kind };
      nodes.set(k, node);
    } else if (analyzed) {
      node.analyzed = true;
    }
    return node;
  };

  // 解析したファイルを先にノードにする(参照先が多くても、解析したファイルは必ず図に出す)
  const analyzedKeys = new Set<string>();
  for (const f of files) {
    const k = key("book", f.name);
    analyzedKeys.add(k);
    nodeFor(k, f.name, true, f.kind === "access" ? "access" : "book");
  }
  const edgeMap = new Map<string, GraphEdge>();
  let omitted = 0;
  const omittedKeys = new Set<string>();
  for (const f of files) {
    const from = nodes.get(key("book", f.name));
    if (!from) continue;
    for (const ref of f.refs) {
      const k = key(ref.kind, ref.name);
      if (k === key("book", f.name)) continue;
      const to = nodeFor(k, ref.name, analyzedKeys.has(k), ref.kind);
      if (!to) {
        if (!omittedKeys.has(k)) {
          omittedKeys.add(k);
          omitted++;
        }
        continue;
      }
      const edgeKey = `${from.id}>${to.id}`;
      const edge = edgeMap.get(edgeKey) ?? { from: from.id, to: to.id, via: [] };
      for (const v of ref.via) if (!edge.via.includes(v)) edge.via.push(v);
      edgeMap.set(edgeKey, edge);
    }
  }
  if (edgeMap.size === 0) return null;

  // つながりのあるノードだけを描く(参照も被参照もない解析済みファイルは図に出さない)
  const connected = new Set([...edgeMap.values()].flatMap((e) => [e.from, e.to]));
  const shownNodes = [...nodes.values()].filter((n) => connected.has(n.id));
  const lines = ["flowchart LR"];
  for (const n of shownNodes) {
    const label = mermaidLabel(n.analyzed ? n.label : `${n.label}(未解析)`);
    lines.push(`  ${n.id}${n.kind === "book" ? (n.analyzed ? `[${label}]` : `(${label})`) : `[(${label})]`}`);
  }
  for (const e of edgeMap.values()) {
    const label = e.via.slice(0, 3).join("・");
    lines.push(`  ${e.from} -->|${mermaidLabel(label)}| ${e.to}`);
  }
  return { nodes: shownNodes, edges: [...edgeMap.values()], code: lines.join("\n"), omitted };
}
