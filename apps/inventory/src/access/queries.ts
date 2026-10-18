// MSysQueries の行から保存済みクエリの SQL を組み立てる。
// 行の意味づけは Jackcess(Apache License 2.0)の QueryImpl 系クラスの解析結果を参考にした。
import type { QueryType } from "../schema";
import { hasCredentials, maskSecrets } from "../secrets";

export interface QueryRow {
  attribute: number;
  expression: string | null;
  flag: number | null;
  extra: number | null;
  name1: string | null;
  name2: string | null;
  order: Uint8Array | null;
}

const ATTR = {
  type: 1,
  parameter: 2,
  flag: 3,
  remoteDb: 4,
  table: 5,
  column: 6,
  join: 7,
  where: 8,
  groupBy: 9,
  having: 10,
  orderBy: 11,
} as const;

const OBJECT_FLAG_TYPE: Record<number, QueryType> = {
  0: "select",
  16: "crosstab",
  32: "delete",
  48: "update",
  64: "append",
  80: "makeTable",
  96: "dataDefinition",
  112: "passThrough",
  128: "union",
};

// MSysQueries の TYPE 行の Flag 値
const ROW_TYPE: Record<number, QueryType> = {
  1: "select",
  2: "makeTable",
  3: "append",
  4: "update",
  5: "delete",
  6: "crosstab",
  7: "dataDefinition",
  8: "passThrough",
  9: "union",
};

const PARAM_TYPE: Record<number, string> = {
  0: "Value",
  1: "Bit",
  10: "Text",
  2: "Byte",
  3: "Short",
  4: "Long",
  5: "Currency",
  6: "IEEESingle",
  7: "IEEEDouble",
  8: "DateTime",
  9: "Binary",
  11: "LongBinary",
  15: "Guid",
};

const JOIN_TYPE: Record<number, string> = { 1: " INNER JOIN ", 2: " LEFT JOIN ", 3: " RIGHT JOIN " };

const SELECT_STAR = 0x01;
const DISTINCT = 0x02;
const OWNER_ACCESS = 0x04;
const DISTINCT_ROW = 0x08;
const TOP = 0x10;
const PERCENT = 0x20;
const APPEND_VALUE = 0x8000;
const CROSSTAB_PIVOT = 0x01;
const CROSSTAB_NORMAL = 0x02;
const UNION_FLAG = 0x02;

export function queryTypeOf(objectFlags: number, rows: QueryRow[]): QueryType {
  const masked = objectFlags & 0xf0;
  if (masked !== 0) return OBJECT_FLAG_TYPE[masked] ?? "unknown";
  const typeRow = rows.find((r) => r.attribute === ATTR.type);
  return typeRow?.flag ? (ROW_TYPE[typeRow.flag] ?? "select") : "select";
}

export interface BuiltQuery {
  type: QueryType;
  sql: string | null;
  tables: string[];
  /** 追加・テーブル作成クエリの書き込み先 */
  target: string | null;
  connect: string | null;
  /** IN [ODBC;…;PWD=…] のような外部データベースの指定にパスワードが書かれていたか */
  remoteCredentials: boolean;
}

export function buildQuery(objectFlags: number, unsorted: QueryRow[]): BuiltQuery {
  const rows = [...unsorted].sort(compareOrder);
  const type = queryTypeOf(objectFlags, rows);
  const q = new QueryRows(rows);
  const tables = rows
    .filter((r) => r.attribute === ATTR.table && r.name1)
    .map((r) => r.name1 as string);
  let sql: string | null;
  try {
    sql = q.toSql(type);
  } catch {
    sql = null;
  }
  // パススルー・データ定義はサーバー側の SQL がそのまま入るので、パスワードの指定を伏せる
  if (sql && (type === "passThrough" || type === "dataDefinition")) sql = maskSecrets(sql);
  const typeRow = q.one(ATTR.type);
  const connect = type === "passThrough" ? (typeRow?.name1 ?? null) : null;
  const target = type === "append" || type === "makeTable" ? (typeRow?.name1 ?? null) : null;
  const remoteCredentials = [q.one(ATTR.remoteDb)?.expression, typeRow?.expression].some((x) => x && x.includes(";") && hasCredentials(x));
  return { type, sql, tables: [...new Set(tables)], target, connect, remoteCredentials };
}

function compareOrder(a: QueryRow, b: QueryRow): number {
  if (a.attribute !== b.attribute) return 0;
  const x = a.order ?? new Uint8Array();
  const y = b.order ?? new Uint8Array();
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}

class QueryRows {
  constructor(private rows: QueryRow[]) {}

  all(attribute: number): QueryRow[] {
    return this.rows.filter((r) => r.attribute === attribute);
  }

  one(attribute: number): QueryRow | undefined {
    return this.all(attribute)[0];
  }

  hasFlag(mask: number): boolean {
    return ((this.one(ATTR.flag)?.flag ?? 0) & mask) !== 0;
  }

  toSql(type: QueryType): string | null {
    switch (type) {
      case "select":
        return this.standard(this.select(true));
      case "delete":
        return this.standard(`DELETE ${this.select(false)}`);
      case "makeTable":
        return this.standard(this.select(true, this.into()));
      case "append":
        return this.standard(this.append());
      case "update":
        return this.standard(this.update());
      case "crosstab":
        return this.standard(this.crosstab());
      case "union":
        return this.standard(this.union());
      case "passThrough":
      case "dataDefinition":
        return this.one(ATTR.type)?.expression?.replace(/\0+$/, "") ?? null;
      default:
        return null;
    }
  }

  private standard(body: string): string {
    const params = this.all(ATTR.parameter).map((r) => {
      let p = `${r.name1} ${PARAM_TYPE[r.flag ?? 0] ?? "Value"}`;
      if (r.flag === 10 && (r.extra ?? 0) > 0) p += `(${r.extra})`;
      return p;
    });
    let sql = params.length > 0 ? `PARAMETERS ${params.join(", ")};\n` : "";
    sql += body;
    if (this.hasFlag(OWNER_ACCESS)) sql += "\nWITH OWNERACCESS OPTION";
    return `${sql};`;
  }

  private selectType(): string {
    if (this.hasFlag(DISTINCT)) return "DISTINCT ";
    if (this.hasFlag(DISTINCT_ROW)) return "DISTINCTROW ";
    if (this.hasFlag(TOP)) return `TOP ${this.one(ATTR.flag)?.name1 ?? ""}${this.hasFlag(PERCENT) ? " PERCENT" : ""} `;
    return "";
  }

  private columns(rows = this.all(ATTR.column)): string[] {
    const cols = rows.map((r) => `${r.expression ?? ""}${alias(r.name1)}`);
    if (this.hasFlag(SELECT_STAR)) cols.push("*");
    return cols;
  }

  private select(prefix: boolean, into = "", columnRows?: QueryRow[], groupRows?: QueryRow[]): string {
    let sql = prefix ? `SELECT ${this.selectType()}` : "";
    sql += this.columns(columnRows).join(", ") + into;
    const from = this.fromTables();
    if (from.length > 0) sql += `\nFROM ${from.join(", ")}${this.remoteDb(this.one(ATTR.remoteDb))}`;
    const where = this.one(ATTR.where)?.expression;
    if (where) sql += `\nWHERE ${where}`;
    const groups = (groupRows ?? this.all(ATTR.groupBy)).map((r) => r.expression ?? "");
    if (groups.length > 0) sql += `\nGROUP BY ${groups.join(", ")}`;
    const having = this.one(ATTR.having)?.expression;
    if (having) sql += `\nHAVING ${having}`;
    const orders = this.orderings();
    if (orders.length > 0) sql += `\nORDER BY ${orders.join(", ")}`;
    return sql;
  }

  private orderings(): string[] {
    return this.all(ATTR.orderBy).map((r) => `${r.expression ?? ""}${(r.name1 ?? "").toUpperCase() === "D" ? " DESC" : ""}`);
  }

  private into(): string {
    const t = this.one(ATTR.type);
    return t?.name1 ? ` INTO ${quoteIdentifier(t.name1)}${this.remoteDb({ ...t, name1: t.name2, expression: t.expression })}` : "";
  }

  /** IN 'パス' [接続文字列]。接続文字列のパスワードは伏せる */
  private remoteDb(row: QueryRow | undefined): string {
    if (!row || (row.name1 === null && row.expression === null)) return "";
    return ` IN '${row.name1 ?? ""}'${row.expression !== null ? ` [${maskSecrets(row.expression)}]` : ""}`;
  }

  private append(): string {
    const t = this.one(ATTR.type);
    const all = this.all(ATTR.column);
    const values = all.filter((r) => ((r.flag ?? 0) & APPEND_VALUE) !== 0);
    const selectCols = all.filter((r) => ((r.flag ?? 0) & APPEND_VALUE) === 0);
    const cols = all.filter((r) => r.name2 !== null).map((r) => quoteIdentifier(r.name2 as string));
    let sql = `INSERT INTO ${quoteIdentifier(t?.name1 ?? "")}`;
    if (cols.length > 0) sql += ` (${cols.join(", ")})`;
    sql += this.remoteDb(t ? { ...t, name1: t.name2 } : undefined);
    sql += "\n";
    if (values.length > 0) return `${sql}VALUES (${values.map((r) => r.expression ?? "").join(", ")})`;
    return sql + this.select(true, "", selectCols);
  }

  private update(): string {
    let sql = `UPDATE ${this.fromTables().join(", ")}${this.remoteDb(this.one(ATTR.remoteDb))}`;
    const sets = this.all(ATTR.column).map((r) => `${quoteIdentifier(r.name2 ?? "")} = ${r.expression ?? ""}`);
    sql += `\nSET ${sets.join(", ")}`;
    const where = this.one(ATTR.where)?.expression;
    if (where) sql += `\nWHERE ${where}`;
    return sql;
  }

  private crosstab(): string {
    const all = this.all(ATTR.column);
    const isFlag = (r: QueryRow, f: number) => ((r.flag ?? 0) & f) !== 0;
    const transform = all.find((r) => !isFlag(r, CROSSTAB_PIVOT | CROSSTAB_NORMAL));
    const pivot = all.find((r) => isFlag(r, CROSSTAB_PIVOT));
    const normal = all.filter((r) => isFlag(r, CROSSTAB_NORMAL));
    const groups = this.all(ATTR.groupBy).filter((r) => isFlag(r, CROSSTAB_NORMAL));
    let sql = transform?.expression ? `TRANSFORM ${transform.expression}${alias(transform.name1)}\n` : "";
    sql += this.select(true, "", normal, groups);
    return `${sql}\nPIVOT ${pivot?.expression ?? ""}`;
  }

  private union(): string {
    const part = (id: string) => {
      const r = this.all(ATTR.table).find((x) => x.name2 === id);
      if (!r?.expression) throw new Error("union part not found");
      return r.expression.trim().replace(/[\r\n]+/g, "\n");
    };
    let sql = `${part("X7YZ_____1")}\nUNION ${this.hasFlag(UNION_FLAG) ? "" : "ALL "}${part("X7YZ_____2")}`;
    const orders = this.orderings();
    if (orders.length > 0) sql += `\nORDER BY ${orders.join(", ")}`;
    return sql;
  }

  private fromTables(): string[] {
    const sources: Source[] = this.all(ATTR.table).map((t) => {
      let sql = t.expression !== null ? `${bracket(t.expression)}.` : "";
      if (t.name1 !== null) sql += quoteIdentifier(t.name1);
      return { names: [t.name2 ?? t.name1 ?? ""], sql: sql + alias(t.name2) };
    });
    const indexOf = (name: string | null) =>
      name === null ? -1 : sources.findIndex((s) => s.names.some((n) => n.toLowerCase() === name.toLowerCase()));

    for (const j of this.all(ATTR.join)) {
      const fromIdx = indexOf(j.name1);
      const toIdx = indexOf(j.name2);
      if (fromIdx >= 0 && fromIdx === toIdx) {
        // 同じ組み合わせの結合条件が複数行ある場合は ON 句をまとめる
        const join = sources[fromIdx].join;
        if (!join || join.type !== j.flag) throw new Error("inconsistent join");
        join.on.unshift(j.expression ?? "");
        sources[fromIdx].sql = renderJoin(join);
        continue;
      }
      const pick = (idx: number, name: string | null): Source =>
        idx >= 0 ? sources[idx] : { names: [name ?? ""], sql: quoteIdentifier(name ?? "") };
      const join: Join = { type: j.flag ?? 1, on: [j.expression ?? ""], left: pick(fromIdx, j.name1), right: pick(toIdx, j.name2) };
      for (const idx of [fromIdx, toIdx].filter((i) => i >= 0).sort((a, b) => b - a)) sources.splice(idx, 1);
      sources.push({ names: [...join.left.names, ...join.right.names], sql: renderJoin(join), join });
    }
    return sources.map((s) => (s.join ? s.sql.slice(1, -1) : s.sql));
  }
}

interface Source {
  names: string[];
  sql: string;
  join?: Join;
}

interface Join {
  type: number;
  on: string[];
  left: Source;
  right: Source;
}

/** 結合は常に括弧付きで組み立て、最上位だけ括弧を外す(Access の SQL ビューと同じ形) */
function renderJoin(j: Join): string {
  const type = JOIN_TYPE[j.type];
  if (!type) throw new Error("unknown join type");
  const on = j.on.length > 1 ? `(${j.on.join(") AND (")})` : j.on[0];
  return `(${j.left.sql}${type}${j.right.sql} ON ${on})`;
}

function alias(name: string | null): string {
  return name !== null ? ` AS ${/[^\p{L}\p{N}_]/u.test(name) ? bracket(name) : name}` : "";
}

function bracket(expr: string): string {
  return expr.length >= 2 && expr.startsWith("[") && expr.endsWith("]") ? expr : `[${expr}]`;
}

/** テーブル名などの識別子。"." 区切りの各部分に記号や空白が含まれる場合だけ [] で囲む */
function quoteIdentifier(name: string): string {
  return name
    .split(".")
    .map((p) => (/[^\p{L}\p{N}_]/u.test(p) ? bracket(p) : p))
    .join(".");
}
