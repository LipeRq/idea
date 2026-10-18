// .accdb / .mdb の解析。mdb-reader でテーブルとシステムテーブル(MSysObjects など)を読む。
// mdb-reader は Node.js の Buffer を前提にしている。Node.js では組み込みの buffer、ブラウザでは npm の buffer パッケージ
// (バンドラが "buffer" を解決する)を使い、グローバルの Buffer が無ければ設定する(mdb-reader のブラウザ版が参照するため)。
import { Buffer } from "buffer";
import MDBReader from "mdb-reader";
import type { AccessInfo, AccessQuery, Dependency, EntryPoint, LinkedTable, Properties, Relationship } from "../schema";
import { CorruptFileError, InventoryError, PasswordError, rethrowIfFatal } from "../errors";
import { EMPTY_PROPERTIES } from "../excel/common";
import { Budget } from "../limits";
import { hasCredentials, maskSecrets } from "../secrets";
import { extractVbaProject, type RawVbaProject } from "../vba/project";
import { buildQuery, type QueryRow } from "./queries";
import { accessStorage, type StorageRow } from "./storage";

export interface AccessExtract {
  access: AccessInfo;
  properties: Properties;
  vba: RawVbaProject | null;
  dependencies: Dependency[];
  entryPoints: EntryPoint[];
  /** 接続文字列に認証情報が含まれていたリンクテーブル・クエリ */
  credentialLocations: string[];
}

const OBJ = {
  table: 1,
  odbcLinked: 4,
  query: 5,
  linked: 6,
  form: -32768,
  report: -32764,
  macro: -32766,
  module: -32761,
} as const;

const ENGINES: Record<number, string> = {
  0: "Jet3(Access 97)",
  1: "Jet4(Access 2000〜2003)",
  2: "ACE12(Access 2007)",
  3: "ACE14(Access 2010)",
  4: "ACE15(Access 2013)",
  5: "ACE16(Access 2016以降)",
  6: "ACE17(Access 2019以降)",
};

type Row = Record<string, unknown>;

/** 1つのクエリとして SQL を組み立てる MSysQueries の行数の上限(通常は数十行) */
const MAX_QUERY_ROWS = 2_000;
/** 暗号化(Office のパスワード暗号化)の鍵導出の繰り返し回数の上限。通常は 100000 */
const MAX_SPIN_COUNT = 10_000_000;

if (typeof (globalThis as { Buffer?: unknown }).Buffer === "undefined") {
  (globalThis as { Buffer?: unknown }).Buffer = Buffer;
}

/**
 * mdb-reader に渡すバッファ。ページの読み出し(slice)のたびに制限時間を確認する。
 * 壊れたファイルでページのつながりが循環していると mdb-reader が止まらなくなるため、その対策。
 */
function guardedBuffer(data: Uint8Array, budget: Budget): Buffer {
  const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const slice = buffer.slice;
  Object.defineProperty(buffer, "slice", {
    value(this: Buffer, start?: number, end?: number) {
      budget.check();
      return slice.call(this, start, end);
    },
  });
  return buffer;
}

export function parseAccess(data: Uint8Array, password: string | undefined, warnings: string[], budget: Budget = new Budget()): AccessExtract {
  const spin = /spinCount="(\d+)"/.exec(new TextDecoder("latin1").decode(data.subarray(0, 8192)));
  if (spin && Number(spin[1]) > MAX_SPIN_COUNT) {
    throw new CorruptFileError(`暗号化の設定(spinCount=${spin[1]})が異常に大きいため、解析を中止しました。ファイルが壊れている可能性があります`);
  }
  let reader: MDBReader;
  try {
    reader = new MDBReader(guardedBuffer(data, budget), { password });
  } catch (e) {
    if (e instanceof InventoryError) throw e;
    if (/password/i.test((e as Error).message)) {
      throw new PasswordError(
        password
          ? "データベースのパスワードが違います"
          : "データベースにパスワードが設定されています。--password でパスワードを指定してください",
      );
    }
    throw new CorruptFileError(`Access のデータベースとして読み込めませんでした(${(e as Error).message})`, { cause: e });
  }
  const credentialLocations: string[] = [];
  const dependencies: Dependency[] = [];
  const entryPoints: EntryPoint[] = [];

  const tables = budget.cap(reader.getTableNames(), budget.limits.maxAccessTables, warnings, "テーブル").map((name) => {
    budget.checkNow();
    try {
      const t = reader.getTable(name);
      return {
        name,
        rowCount: t.rowCount,
        columns: t.getColumns().map((c) => ({
          name: c.name,
          type: c.type,
          size: c.size,
          nullable: c.nullable,
          autoNumber: c.autoLong || c.autoUUID,
        })),
      };
    } catch (e) {
      rethrowIfFatal(e);
      warnings.push(`テーブル「${name}」の定義を読めませんでした: ${(e as Error).message}`);
      return { name, rowCount: 0, columns: [] };
    }
  });

  const objects = readSystemTable(reader, "MSysObjects", warnings, budget);
  const byType = (type: number) =>
    objects.filter((o) => o.Type === type && typeof o.Name === "string" && !String(o.Name).startsWith("~"));
  const names = (type: number) => byType(type).map((o) => String(o.Name)).sort((a, b) => a.localeCompare(b, "ja"));

  const linkedTables: LinkedTable[] = [...byType(OBJ.linked), ...byType(OBJ.odbcLinked)].map((o) => {
    const connect = str(o.Connect);
    const database = str(o.Database);
    if (connect && hasCredentials(connect)) credentialLocations.push(`リンクテーブル「${o.Name}」`);
    const linked: LinkedTable = {
      name: String(o.Name),
      kind: linkKind(o.Type as number, connect),
      sourceTable: str(o.ForeignName),
      database,
      connect: connect ? maskSecrets(connect) : null,
    };
    dependencies.push({
      kind: "linkedTable",
      target: linked.database ?? linked.connect ?? linked.name,
      category: linked.kind,
      location: { part: "MSysObjects", procedure: linked.name },
    });
    return linked;
  });

  const queryRows = new Map<number, QueryRow[]>();
  for (const r of readSystemTable(reader, "MSysQueries", warnings, budget)) {
    const id = r.ObjectId as number;
    const list = queryRows.get(id) ?? [];
    list.push({
      attribute: Number(r.Attribute),
      expression: str(r.Expression),
      flag: typeof r.Flag === "number" ? r.Flag : null,
      extra: typeof r.LvExtra === "number" ? r.LvExtra : null,
      name1: str(r.Name1),
      name2: str(r.Name2),
      order: r.Order instanceof Uint8Array ? r.Order : null,
    });
    queryRows.set(id, list);
  }
  const queries: AccessQuery[] = objects
    .filter((o) => o.Type === OBJ.query && typeof o.Name === "string")
    .map((o) => {
      const name = String(o.Name);
      budget.check();
      const rows = queryRows.get(o.Id as number) ?? [];
      const built =
        rows.length > MAX_QUERY_ROWS
          ? { type: "unknown" as const, sql: null, tables: [], target: null, connect: null, remoteCredentials: false }
          : buildQuery(Number(o.Flags ?? 0), rows);
      if (rows.length > MAX_QUERY_ROWS) warnings.push(`クエリ「${name}」の定義が大きすぎるため、SQLを復元していません`);
      else if (built.sql === null && built.type !== "unknown") {
        warnings.push(`クエリ「${name}」のSQLを復元できませんでした`);
      }
      if (built.connect && hasCredentials(built.connect)) credentialLocations.push(`パススルークエリ「${name}」`);
      if (built.remoteCredentials) credentialLocations.push(`クエリ「${name}」の外部データベース指定`);
      if (built.connect) {
        dependencies.push({
          kind: "connectionString",
          target: maskSecrets(built.connect),
          category: hasCredentials(built.connect) ? "認証情報を含む" : null,
          location: { part: "MSysQueries", procedure: name },
        });
      }
      return {
        name,
        type: built.type,
        hidden: name.startsWith("~"),
        sql: built.sql,
        tables: built.tables,
        target: built.target,
        connect: built.connect ? maskSecrets(built.connect) : null,
      };
    })
    .sort((a, b) => Number(a.hidden) - Number(b.hidden) || a.name.localeCompare(b.name, "ja"));

  const relationships = readRelationships(readSystemTable(reader, "MSysRelationships", warnings, budget));

  const macros = names(OBJ.macro);
  for (const m of macros) {
    if (m.toLowerCase() === "autoexec") {
      entryPoints.push({ kind: "accessMacro", trigger: "データベースを開いたとき(AutoExec マクロ)", procedure: null, target: m, location: { part: "MSysObjects" } });
    } else if (m.toLowerCase() === "autokeys") {
      entryPoints.push({ kind: "shortcut", trigger: "キー操作(AutoKeys マクロ)", procedure: null, target: m, location: { part: "MSysObjects" } });
    }
  }

  let vba: RawVbaProject | null = null;
  let vbaStatus: AccessInfo["vbaStatus"] = "none";
  if (data[0x14] === 0) warnings.push("Access 97(Jet3)形式のため、VBAモジュールは解析していません");
  try {
    const storageRows: StorageRow[] = readSystemTable(reader, "MSysAccessStorage", warnings, budget).map((r) => ({
      id: Number(r.Id),
      parentId: Number(r.ParentId),
      name: String(r.Name ?? ""),
      type: Number(r.Type),
      data: r.Lv instanceof Uint8Array ? r.Lv : null,
    }));
    vba = storageRows.length > 0 ? extractVbaProject(accessStorage(storageRows), warnings, budget) : null;
    if (vba && vba.modules.length > 0) vbaStatus = "extracted";
  } catch (e) {
    rethrowIfFatal(e);
    vbaStatus = "failed";
    warnings.push(`AccessのVBAプロジェクトを読めませんでした: ${(e as Error).message}`);
  }

  // 件数が多くても落ちないように(Math.max(...配列) は要素数が多いとスタックがあふれる)
  let latest = -Infinity;
  for (const o of objects) {
    if (o.DateUpdate instanceof Date && !Number.isNaN(o.DateUpdate.getTime())) latest = Math.max(latest, o.DateUpdate.getTime());
  }
  const created = safeDate(() => reader.getCreationDate());
  const modified = latest > -Infinity ? new Date(latest) : null;

  return {
    access: {
      engine: ENGINES[data[0x14]] ?? `不明(0x${data[0x14]?.toString(16)})`,
      tables,
      linkedTables,
      queries,
      relationships,
      forms: names(OBJ.form),
      reports: names(OBJ.report),
      macros,
      modules: names(OBJ.module),
      vbaStatus,
    },
    properties: {
      ...EMPTY_PROPERTIES,
      created: created ? created.toISOString() : null,
      modified: modified ? modified.toISOString() : null,
      application: "Microsoft Access",
    },
    vba,
    dependencies,
    entryPoints,
    credentialLocations,
  };
}

function readSystemTable(reader: MDBReader, name: string, warnings: string[], budget: Budget): Row[] {
  try {
    const rowLimit = budget.limits.maxSystemRows;
    const rows = reader.getTable(name).getData({ rowLimit }) as Row[];
    if (rows.length >= rowLimit) warnings.push(`システムテーブル ${name} の行が多すぎるため、先頭の ${rowLimit} 行だけを読みました`);
    return rows;
  } catch (e) {
    rethrowIfFatal(e);
    const msg = (e as Error).message;
    if (!/could not find table/i.test(msg)) warnings.push(`システムテーブル ${name} を読めませんでした: ${msg}`);
    return [];
  }
}

function safeDate(read: () => Date | null): Date | null {
  try {
    const d = read();
    return d && !Number.isNaN(d.getTime()) ? d : null;
  } catch (e) {
    rethrowIfFatal(e);
    return null;
  }
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function linkKind(type: number, connect: string | null): LinkedTable["kind"] {
  if (type === OBJ.odbcLinked || /^ODBC;/i.test(connect ?? "")) return "odbc";
  if (!connect || /^;/.test(connect) || /^MS Access;/i.test(connect)) return "access";
  if (/^Excel/i.test(connect)) return "excel";
  if (/^Text;/i.test(connect)) return "text";
  if (/^WSS;/i.test(connect)) return "sharepoint";
  return "other";
}

// MSysRelationships の grbit
const REL_ONE_TO_ONE = 0x00000001;
const REL_NO_INTEGRITY = 0x00000002;
const REL_CASCADE_UPDATE = 0x00000100;
const REL_CASCADE_DELETE = 0x00001000;

export function readRelationships(rows: Row[]): Relationship[] {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const obj = String(r.szObject ?? "");
    const ref = String(r.szReferencedObject ?? "");
    if (obj.startsWith("MSys") || ref.startsWith("MSys")) continue;
    const key = String(r.szRelationship ?? "");
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([name, list]) => {
    const sorted = [...list].sort((a, b) => Number(a.icolumn ?? 0) - Number(b.icolumn ?? 0));
    const grbit = Number(sorted[0].grbit ?? 0);
    return {
      name,
      primaryTable: String(sorted[0].szReferencedObject),
      primaryColumns: sorted.map((r) => String(r.szReferencedColumn)),
      foreignTable: String(sorted[0].szObject),
      foreignColumns: sorted.map((r) => String(r.szColumn)),
      oneToOne: (grbit & REL_ONE_TO_ONE) !== 0,
      enforced: (grbit & REL_NO_INTEGRITY) === 0,
      cascadeUpdate: (grbit & REL_CASCADE_UPDATE) !== 0,
      cascadeDelete: (grbit & REL_CASCADE_DELETE) !== 0,
    };
  });
}
