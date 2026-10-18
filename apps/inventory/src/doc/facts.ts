// レポートから機械的に組み立てる事実(件数・規模・依存のまとめ)。Markdown と AI への入力の両方で使う。
import {
  DEPENDENCY_KIND_LABEL,
  type Dependency,
  type DependencyKind,
  type InventoryReport,
} from "../schema";

export type Level = "低" | "中" | "高";

export interface Complexity {
  size: "S" | "M" | "L" | "XL";
  level: Level;
  reasons: string[];
}

/** 移行難易度の機械的な目安。規模・外部連携・画面・環境依存の有無から決める */
export function estimateComplexity(r: InventoryReport): Complexity {
  const lines = r.stats.codeLineCount;
  const access = r.access;
  const objects = access ? access.tables.length + access.queries.filter((q) => !q.hidden).length + access.forms.length + access.reports.length : 0;
  const size = lines >= 10_000 || objects >= 200 ? "XL" : lines >= 2_000 || objects >= 60 ? "L" : lines >= 300 || objects >= 15 ? "M" : "S";
  const reasons: string[] = [`コード ${lines.toLocaleString("ja-JP")} 行${access ? `、Accessオブジェクト ${objects} 個` : ""}(規模 ${size})`];
  let score = { S: 0, M: 1, L: 2, XL: 3 }[size];

  const kinds = externalKinds(r.dependencies);
  if (kinds.length >= 3) {
    score++;
    reasons.push(`外部とのやり取りが ${kinds.length} 種類(${kinds.map((k) => DEPENDENCY_KIND_LABEL[k]).join("、")})`);
  }
  const forms = (r.vba?.modules.filter((m) => m.type === "form").length ?? 0) + (access?.forms.length ?? 0);
  if (forms > 0) {
    score++;
    reasons.push(`入力画面(フォーム)が ${forms} 個`);
  }
  const fragile = r.findings.filter((f) => ["VBA-API-64BIT", "IE-AUTOMATION", "SENDKEYS", "XLM-MACRO"].includes(f.ruleId));
  if (fragile.length > 0) {
    score++;
    reasons.push(`環境依存の強い処理(${fragile.map((f) => f.title).join("、")})`);
  }
  return { size, level: score <= 1 ? "低" : score <= 3 ? "中" : "高", reasons };
}

const NON_EXTERNAL: DependencyKind[] = ["reference", "sql", "environment", "print"];

export function externalKinds(deps: Dependency[]): DependencyKind[] {
  return [...new Set(deps.filter((d) => !NON_EXTERNAL.includes(d.kind)).map((d) => d.kind))];
}

export interface DependencyGroup {
  kind: DependencyKind;
  label: string;
  items: { target: string; category: string | null; count: number; locations: Dependency["location"][] }[];
}

/** 依存を種類ごと・対象ごとにまとめる(同じパスが何か所にもあれば1行にする) */
export function groupDependencies(deps: Dependency[]): DependencyGroup[] {
  const groups = new Map<DependencyKind, DependencyGroup>();
  const items = new Map<string, DependencyGroup["items"][number]>();
  for (const d of deps) {
    let g = groups.get(d.kind);
    if (!g) {
      g = { kind: d.kind, label: DEPENDENCY_KIND_LABEL[d.kind], items: [] };
      groups.set(d.kind, g);
    }
    const key = `${d.kind}\u0000${d.target}\u0000${d.category ?? "\u0001"}`;
    const item = items.get(key);
    if (item) {
      item.count++;
      item.locations.push(d.location);
    } else {
      const created = { target: d.target, category: d.category, count: 1, locations: [d.location] };
      items.set(key, created);
      g.items.push(created);
    }
  }
  return [...groups.values()];
}

export function formatLocation(l: Dependency["location"]): string {
  if (l.module) return `${l.module}${l.procedure ? `.${l.procedure}` : ""}${l.line ? ` (${l.line}行目)` : ""}`;
  if (l.procedure) return `${l.part ?? ""} ${l.procedure}`.trim();
  return l.part ?? "";
}

export const FORMAT_LABEL: Record<InventoryReport["file"]["format"], string> = {
  xlsm: "Excel マクロ有効ブック(.xlsm)",
  xlam: "Excel アドイン(.xlam)",
  xlsx: "Excel ブック(.xlsx)",
  xltm: "Excel マクロ有効テンプレート(.xltm)",
  xlsb: "Excel バイナリブック(.xlsb)",
  xls: "Excel 97-2003 ブック(.xls)",
  accdb: "Access データベース(.accdb)",
  mdb: "Access 2003以前のデータベース(.mdb)",
};
