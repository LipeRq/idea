// AI に渡すソースを、モジュール単位(大きいモジュールはプロシージャ単位)に分けて、1回の依頼に収まる束にする。
// 入力を黙って切り捨てることはしない。どうしても分ける場合は「続き」として別の単位にする。
import { MODULE_TYPE_LABEL, QUERY_TYPE_LABEL, type InventoryReport } from "../schema";

/** 日本語は1文字≒1トークン強、英数字は3文字≒1トークンとして多めに見積もる */
export function estimateTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (const c of text) {
    if (c.charCodeAt(0) < 0x80) ascii++;
    else other++;
  }
  return Math.ceil(ascii / 3 + other * 1.3);
}

export interface Unit {
  /** AI の出力と突き合わせるための名前(モジュール名、または「保存済みクエリ」) */
  name: string;
  kind: string;
  part: number;
  totalParts: number;
  lines: string | null;
  /** このユニットで要約してほしいプロシージャ(クエリ)名 */
  procedures: string[];
  text: string;
  tokens: number;
}

export const QUERIES_UNIT = "保存済みクエリ";

export interface ChunkOptions {
  /** 1回の依頼に入れるソースの上限(推定トークン) */
  maxTokens: number;
  /** 1回の依頼で要約させるプロシージャ数の上限(出力の長さを抑える) */
  maxProcedures: number;
}

export const DEFAULT_CHUNK: ChunkOptions = { maxTokens: 30_000, maxProcedures: 120 };

export function buildUnits(r: InventoryReport, opts: ChunkOptions = DEFAULT_CHUNK): Unit[] {
  const units: Unit[] = [];
  for (const m of r.vba?.modules ?? []) {
    if (m.source === null || m.source.trim() === "") continue;
    const lines = m.source.split("\n");
    const pieces = splitModule(lines, m.procedures, opts);
    pieces.forEach((p, i) =>
      units.push({
        name: m.name,
        kind: MODULE_TYPE_LABEL[m.type],
        part: i + 1,
        totalParts: pieces.length,
        lines: `${p.start}-${p.end}`,
        procedures: p.procedures,
        text: lines.slice(p.start - 1, p.end).join("\n"),
        tokens: estimateTokens(lines.slice(p.start - 1, p.end).join("\n")),
      }),
    );
  }

  const queries = (r.access?.queries ?? []).filter((q) => !q.hidden && q.sql);
  let current: Unit | null = null;
  const parts: Unit[] = [];
  for (const q of queries) {
    const text = `-- ${q.name}(${QUERY_TYPE_LABEL[q.type]})\n${q.sql}\n`;
    const tokens = estimateTokens(text);
    if (!current || current.tokens + tokens > opts.maxTokens || current.procedures.length >= opts.maxProcedures) {
      current = { name: QUERIES_UNIT, kind: "Accessのクエリ", part: 0, totalParts: 0, lines: null, procedures: [], text: "", tokens: 0 };
      parts.push(current);
    }
    current.procedures.push(q.name);
    current.text += text;
    current.tokens += tokens;
  }
  parts.forEach((p, i) => units.push({ ...p, part: i + 1, totalParts: parts.length }));
  return units;
}

interface Piece {
  start: number;
  end: number;
  procedures: string[];
}

/**
 * モジュールを行範囲に分ける。プロシージャの途中では切らず、1つのプロシージャが上限を超えるときだけ行で分ける
 * (その場合は分けた各部分で同じプロシージャの要約を頼み、後で連結する)。
 */
function splitModule(lines: string[], procs: { name: string; startLine: number; endLine: number }[], opts: ChunkOptions): Piece[] {
  const total = estimateTokens(lines.join("\n"));
  if (total <= opts.maxTokens && procs.length <= opts.maxProcedures) {
    return [{ start: 1, end: lines.length, procedures: procs.map((p) => p.name) }];
  }
  // 宣言部やプロシージャ間の行は直後のプロシージャに含める
  const blocks: Piece[] = [];
  let cursor = 1;
  for (const p of procs) {
    blocks.push({ start: cursor, end: p.endLine, procedures: [p.name] });
    cursor = p.endLine + 1;
  }
  if (cursor <= lines.length) {
    if (blocks.length > 0) blocks[blocks.length - 1].end = lines.length;
    else blocks.push({ start: cursor, end: lines.length, procedures: [] });
  }
  const tokensOf = (b: Piece) => estimateTokens(lines.slice(b.start - 1, b.end).join("\n"));

  const pieces: Piece[] = [];
  let cur: Piece | null = null;
  let curTokens = 0;
  for (const b of blocks) {
    const t = tokensOf(b);
    if (t > opts.maxTokens) {
      if (cur) pieces.push(cur);
      cur = null;
      curTokens = 0;
      pieces.push(...splitByLines(lines, b, opts.maxTokens));
      continue;
    }
    if (cur && (curTokens + t > opts.maxTokens || cur.procedures.length + b.procedures.length > opts.maxProcedures)) {
      pieces.push(cur);
      cur = null;
      curTokens = 0;
    }
    if (!cur) cur = { start: b.start, end: b.end, procedures: [] };
    cur.end = b.end;
    cur.procedures.push(...b.procedures);
    curTokens += t;
  }
  if (cur) pieces.push(cur);
  return pieces;
}

function splitByLines(lines: string[], block: Piece, maxTokens: number): Piece[] {
  const pieces: Piece[] = [];
  let start = block.start;
  let tokens = 0;
  for (let n = block.start; n <= block.end; n++) {
    const t = estimateTokens(lines[n - 1]) + 1;
    if (tokens + t > maxTokens && n > start) {
      pieces.push({ start, end: n - 1, procedures: block.procedures });
      start = n;
      tokens = 0;
    }
    tokens += t;
  }
  pieces.push({ start, end: block.end, procedures: block.procedures });
  return pieces;
}

/** ユニットを1回の依頼に収まる束にまとめる(順番は保つ) */
export function batchUnits(units: Unit[], opts: ChunkOptions = DEFAULT_CHUNK): Unit[][] {
  const batches: Unit[][] = [];
  let cur: Unit[] = [];
  let tokens = 0;
  let procs = 0;
  for (const u of units) {
    if (cur.length > 0 && (tokens + u.tokens > opts.maxTokens || procs + u.procedures.length > opts.maxProcedures)) {
      batches.push(cur);
      cur = [];
      tokens = 0;
      procs = 0;
    }
    cur.push(u);
    tokens += u.tokens;
    procs += u.procedures.length;
  }
  if (cur.length > 0) batches.push(cur);
  return batches;
}
