// Mermaid の図を組み立てる。ラベルはすべて引用符で囲み、ID は n1, n2 ... の連番にする。
import type { InventoryReport } from "../schema";

/** Mermaid のラベル。引用符・山括弧・バッククォート(Markdown のコードフェンスを閉じないように)・改行を無害化する */
export function mermaidLabel(text: string): string {
  return `"${text
    .replace(/#/g, "#35;")
    .replace(/"/g, "#quot;")
    .replace(/</g, "#lt;")
    .replace(/>/g, "#gt;")
    .replace(/`/g, "#96;")
    .replace(/[\r\n]+/g, " ")}"`;
}

export const MAX_GRAPH_NODES = 60;

export interface Diagram {
  code: string;
  /** 表示しきれずに省いたノード数(0 なら全体を表示) */
  omitted: number;
}

/**
 * 起動のきっかけ → プロシージャ → 呼び出し先 の流れ図。
 * ノードが多すぎるときは起動のきっかけに近いものから MAX_GRAPH_NODES 個までを描き、省いた数を返す。
 */
export function callFlowDiagram(r: InventoryReport, maxNodes = MAX_GRAPH_NODES): Diagram | null {
  if (r.callGraph.length === 0 && r.entryPoints.length === 0) return null;
  const adjacency = new Map<string, { to: string; kind: string }[]>();
  for (const e of r.callGraph) {
    const list = adjacency.get(e.from) ?? [];
    list.push({ to: e.to, kind: e.kind });
    adjacency.set(e.from, list);
  }

  // 起動のきっかけから幅優先でたどり、近い順にノードを選ぶ
  const order: string[] = [];
  const seen = new Set<string>();
  const queue: string[] = [];
  const entries = r.entryPoints.filter((e) => e.procedure && e.kind !== "macro");
  for (const e of entries) {
    if (!seen.has(e.procedure!)) {
      seen.add(e.procedure!);
      queue.push(e.procedure!);
    }
  }
  const all = new Set([...r.callGraph.flatMap((e) => [e.from, e.to])]);
  let head = 0;
  const visit = () => {
    while (head < queue.length) {
      const cur = queue[head++];
      order.push(cur);
      for (const next of adjacency.get(cur) ?? []) {
        if (!seen.has(next.to)) {
          seen.add(next.to);
          queue.push(next.to);
        }
      }
    }
  };
  visit();
  // 起動経路から届かない呼び出し関係(手動実行のマクロ等)も後ろに足す
  for (const node of [...r.entryPoints.filter((e) => e.kind === "macro").map((e) => e.procedure!), ...all]) {
    if (node && !seen.has(node)) {
      seen.add(node);
      queue.push(node);
      visit();
    }
  }

  const shown = new Set(order.slice(0, maxNodes));
  const ids = new Map<string, string>();
  const id = (key: string) => {
    if (!ids.has(key)) ids.set(key, `n${ids.size + 1}`);
    return ids.get(key)!;
  };
  const lines = ["flowchart LR"];
  const triggers = new Map<string, string[]>();
  for (const e of r.entryPoints) {
    if (!e.procedure || !shown.has(e.procedure)) continue;
    const list = triggers.get(e.trigger) ?? [];
    if (!list.includes(e.procedure)) list.push(e.procedure);
    triggers.set(e.trigger, list);
  }
  for (const [trigger, procs] of triggers) {
    const t = id(`trigger:${trigger}`);
    lines.push(`  ${t}([${mermaidLabel(trigger)}])`);
    for (const p of procs) lines.push(`  ${t} --> ${id(p)}`);
  }
  for (const node of shown) {
    const isModule = !node.includes(".");
    lines.push(`  ${id(node)}${isModule ? `[[${mermaidLabel(`${node}(画面)`)}]]` : `[${mermaidLabel(node)}]`}`);
  }
  for (const e of r.callGraph) {
    if (!shown.has(e.from) || !shown.has(e.to)) continue;
    const label = e.kind === "run" ? "|Run/OnTime|" : e.kind === "formShow" ? "|表示|" : "";
    lines.push(`  ${id(e.from)} -->${label} ${id(e.to)}`);
  }
  return { code: lines.join("\n"), omitted: Math.max(0, order.length - shown.size) };
}

export interface FlowStep {
  id: string;
  label: string;
  actor: string;
  next: string[];
}

/** AI が返した業務フローのステップを図にする(構文は必ずこちらで組み立てる) */
export function businessFlowDiagram(steps: FlowStep[]): string {
  const ids = new Map(steps.map((s, i) => [s.id, `s${i + 1}`]));
  const lines = ["flowchart TD"];
  for (const s of steps) {
    const shape =
      s.actor === "利用者" ? `([${mermaidLabel(s.label)}])` : s.actor === "外部システム" ? `[(${mermaidLabel(s.label)})]` : `[${mermaidLabel(s.label)}]`;
    lines.push(`  ${ids.get(s.id)}${shape}`);
  }
  for (const s of steps) {
    for (const n of s.next) {
      const to = ids.get(n);
      if (to) lines.push(`  ${ids.get(s.id)} --> ${to}`);
    }
  }
  return lines.join("\n");
}

/** Access のリレーションシップ図(テーブル → テーブル) */
export function relationshipDiagram(r: InventoryReport): string | null {
  const rels = r.access?.relationships ?? [];
  if (rels.length === 0) return null;
  const ids = new Map<string, string>();
  const id = (t: string) => {
    if (!ids.has(t)) ids.set(t, `t${ids.size + 1}`);
    return ids.get(t)!;
  };
  const lines = ["flowchart LR"];
  for (const rel of rels) {
    const label = `${rel.primaryColumns.join(",")} → ${rel.foreignColumns.join(",")}${rel.oneToOne ? "(1:1)" : "(1:多)"}`;
    lines.push(`  ${id(rel.primaryTable)}[${mermaidLabel(rel.primaryTable)}] -->|${mermaidLabel(label)}| ${id(rel.foreignTable)}[${mermaidLabel(rel.foreignTable)}]`);
  }
  return lines.join("\n");
}

/** Access のクエリとテーブルの関係(どのテーブルを読んで、どこへ書き込むか) */
export function queryDiagram(r: InventoryReport, maxNodes = MAX_GRAPH_NODES): Diagram | null {
  const queries = (r.access?.queries ?? []).filter((q) => !q.hidden);
  if (queries.length === 0) return null;
  const queryNames = new Set(queries.map((q) => q.name));
  const ids = new Map<string, string>();
  const nodes: string[] = [];
  const lines = ["flowchart LR"];
  const node = (name: string) => {
    if (!ids.has(name)) {
      if (ids.size >= maxNodes) return null;
      const id = `q${ids.size + 1}`;
      ids.set(name, id);
      nodes.push(queryNames.has(name) ? `  ${id}[${mermaidLabel(name)}]` : `  ${id}[(${mermaidLabel(name)})]`);
    }
    return ids.get(name)!;
  };
  const edges: string[] = [];
  let omitted = 0;
  for (const q of queries) {
    const to = node(q.name);
    if (!to) {
      omitted++;
      continue;
    }
    for (const t of q.tables) {
      const from = node(t);
      if (from) edges.push(`  ${from} --> ${to}`);
    }
    const written = q.target ?? (q.type === "update" || q.type === "delete" ? q.tables[0] : null);
    if (written) {
      const target = node(written);
      if (target) edges.push(`  ${to} -->|${q.type === "delete" ? "削除" : q.type === "update" ? "更新" : "書き込み"}| ${target}`);
    }
  }
  return { code: [...lines, ...nodes, ...edges].join("\n"), omitted };
}
