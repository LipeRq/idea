// [MS-CFB] 複合ファイル(OLE。.xls 本体と vbaProject.bin)の読み取り。
// 信頼できないファイルを読むため、セクタチェーンの循環・範囲外参照・ディレクトリツリーの循環を検出し、
// ストリームは必要になったときだけ取り出す(サイズは Budget で制限する)。Uint8Array だけで動き、ブラウザでも使える。
import { CorruptFileError, LimitExceededError } from "../errors";
import { Budget } from "../limits";

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const MAXREGSECT = 0xfffffffa;
const ENDOFCHAIN = 0xfffffffe;
const NOSTREAM = 0xffffffff;
const MINI_SECTOR = 64;
const ENTRY_SIZE = 128;
/** ディレクトリエントリ数の上限(1エントリ 128 バイト。通常のファイルは数十〜数百) */
const MAX_ENTRIES = 100_000;
const MAX_DEPTH = 64;

export interface CfbEntry {
  name: string;
  /** ルートからのパス("VBA/dir" など。ルート自身は "") */
  path: string;
  type: "storage" | "stream" | "root";
  size: number;
  start: number;
}

const corrupt = (detail: string) => new CorruptFileError(`OLE 複合ファイルの構造が壊れています(${detail})`);

export class CompoundFile {
  readonly entries: CfbEntry[] = [];
  private readonly byPath = new Map<string, CfbEntry>();
  private readonly view: DataView;
  private readonly sectorSize: number;
  private readonly sectorCount: number;
  private readonly fat: Uint32Array;
  private readonly miniCutoff: number;
  private readonly firstMiniFat: number;
  private miniFat: Uint32Array | null = null;
  private miniStream: Uint8Array | null = null;
  private readonly seen: Uint32Array;
  private generation = 0;

  constructor(
    private readonly data: Uint8Array,
    private readonly budget: Budget = new Budget(),
  ) {
    if (data.length < 512 || !SIGNATURE.every((b, i) => data[i] === b)) throw corrupt("ヘッダの署名が不正です");
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const major = this.u16(0x1a);
    const shift = this.u16(0x1e);
    if (shift !== 9 && shift !== 12) throw corrupt(`セクタサイズの指定(${shift})が不正です`);
    if (this.u16(0x20) !== 6) throw corrupt("ミニセクタサイズの指定が不正です");
    this.sectorSize = 1 << shift;
    this.sectorCount = Math.max(0, Math.ceil((data.length - this.sectorSize) / this.sectorSize));
    this.seen = new Uint32Array(Math.max(this.sectorCount, Math.ceil(data.length / MINI_SECTOR)));
    this.miniCutoff = this.u32(0x38) || 4096;
    this.firstMiniFat = this.u32(0x3c);

    this.fat = this.readFat();
    const dir = this.readChain(this.u32(0x30), this.fat, this.sectorCount, (s) => this.sectorOffset(s), this.sectorSize);
    this.readDirectory(dir, major === 4);
  }

  /** パス(大文字小文字は区別しない。先頭の "/" はあってもよい)でエントリを探す */
  find(path: string): CfbEntry | null {
    return this.byPath.get(normalize(path)) ?? null;
  }

  /** ストリームの内容を読む。無ければ null */
  read(path: string): Uint8Array | null {
    const entry = this.find(path);
    if (!entry || entry.type !== "stream") return null;
    return this.readEntry(entry);
  }

  private u16(at: number): number {
    return this.view.getUint16(at, true);
  }

  private u32(at: number): number {
    return this.view.getUint32(at, true);
  }

  private sectorOffset(sector: number): number {
    return (sector + 1) * this.sectorSize;
  }

  /** ヘッダの DIFAT と DIFAT セクタのチェーンから FAT を組み立てる */
  private readFat(): Uint32Array {
    const fatSectors: number[] = [];
    const push = (s: number) => {
      if (s > MAXREGSECT) return;
      if (s >= this.sectorCount) throw corrupt("FAT セクタの位置がファイルの外を指しています");
      fatSectors.push(s);
      if (fatSectors.length > this.sectorCount) throw corrupt("FAT セクタが多すぎます");
    };
    for (let i = 0; i < 109; i++) push(this.u32(0x4c + i * 4));

    const perSector = this.sectorSize / 4 - 1;
    const visited = new Set<number>();
    let difat = this.u32(0x44);
    let remaining = this.u32(0x48);
    while (difat <= MAXREGSECT && remaining-- > 0) {
      if (difat >= this.sectorCount) throw corrupt("DIFAT セクタの位置がファイルの外を指しています");
      if (visited.has(difat)) throw corrupt("DIFAT のチェーンが循環しています");
      visited.add(difat);
      const at = this.sectorOffset(difat);
      for (let i = 0; i < perSector; i++) push(this.safeU32(at + i * 4));
      difat = this.safeU32(at + perSector * 4);
      this.budget.check();
    }

    const perFat = this.sectorSize / 4;
    const fat = new Uint32Array(fatSectors.length * perFat).fill(ENDOFCHAIN);
    fatSectors.forEach((s, i) => {
      const at = this.sectorOffset(s);
      for (let j = 0; j < perFat; j++) fat[i * perFat + j] = this.safeU32(at + j * 4);
    });
    return fat;
  }

  /** ファイル末尾を超える位置は「チェーンの終わり」として読む(最後のセクタが欠けたファイル向け) */
  private safeU32(at: number): number {
    return at + 4 <= this.data.length ? this.u32(at) : ENDOFCHAIN;
  }

  /**
   * セクタのチェーンをたどって内容をつなげる。循環・範囲外参照は CorruptFileError。
   * maxBytes を超えた分は読まない(ストリームのサイズまで読めば十分なため)。
   */
  private readChain(
    start: number,
    table: Uint32Array,
    count: number,
    offsetOf: (s: number) => number,
    unit: number,
    maxBytes = Infinity,
    source: Uint8Array = this.data,
  ): Uint8Array {
    const sectors: number[] = [];
    const gen = ++this.generation;
    let s = start;
    while (s <= MAXREGSECT && sectors.length * unit < maxBytes) {
      if (s >= count) throw corrupt("セクタのチェーンがファイルの外を指しています");
      if (this.seen[s] === gen) throw corrupt("セクタのチェーンが循環しています");
      this.seen[s] = gen;
      sectors.push(s);
      s = s < table.length ? table[s] : ENDOFCHAIN;
      this.budget.check();
    }
    const length = Math.min(sectors.length * unit, maxBytes);
    const out = new Uint8Array(length);
    sectors.forEach((sec, i) => {
      const at = offsetOf(sec);
      const piece = source.subarray(at, Math.min(at + unit, source.length, at + (length - i * unit)));
      out.set(piece, i * unit);
    });
    return out;
  }

  private readDirectory(dir: Uint8Array, version4: boolean) {
    const count = Math.floor(dir.length / ENTRY_SIZE);
    if (count === 0) throw corrupt("ディレクトリがありません");
    if (count > MAX_ENTRIES) {
      throw new LimitExceededError("entryCount", `OLE 複合ファイルのエントリ数(${count})が上限(${MAX_ENTRIES})を超えています。ファイルが壊れている可能性があります。`);
    }
    const view = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
    const raw = Array.from({ length: count }, (_, i) => {
      const at = i * ENTRY_SIZE;
      const nameLength = Math.min(view.getUint16(at + 64, true), 64);
      const name = new TextDecoder("utf-16le").decode(dir.subarray(at, at + Math.max(0, nameLength - 2))).replace(/\0+$/, "");
      const sizeLow = view.getUint32(at + 120, true);
      const sizeHigh = version4 ? view.getUint32(at + 124, true) : 0;
      return {
        name,
        type: dir[at + 66],
        left: view.getUint32(at + 68, true),
        right: view.getUint32(at + 72, true),
        child: view.getUint32(at + 76, true),
        start: view.getUint32(at + 116, true),
        size: sizeHigh * 2 ** 32 + sizeLow,
      };
    });
    if (raw[0].type !== 5) throw corrupt("ルートエントリがありません");
    const root: CfbEntry = { name: raw[0].name, path: "", type: "root", size: raw[0].size, start: raw[0].start };
    this.entries.push(root);

    // ツリー(兄弟は赤黒木、子は child)を明示的なスタックでたどる。一度訪れたエントリには戻らない
    const visited = new Uint8Array(count);
    visited[0] = 1;
    const stack: { id: number; parent: string; depth: number }[] = [];
    const pushSiblings = (first: number, parent: string, depth: number) => {
      if (depth > MAX_DEPTH) throw corrupt("ストレージの階層が深すぎます");
      const pending = [first];
      while (pending.length > 0) {
        const id = pending.pop()!;
        if (id === NOSTREAM || id >= count || visited[id]) continue;
        visited[id] = 1;
        stack.push({ id, parent, depth });
        pending.push(raw[id].left, raw[id].right);
      }
    };
    pushSiblings(raw[0].child, "", 1);
    while (stack.length > 0) {
      const { id, parent, depth } = stack.pop()!;
      const e = raw[id];
      if (e.type !== 1 && e.type !== 2) continue;
      const path = parent ? `${parent}/${e.name}` : e.name;
      const entry: CfbEntry = { name: e.name, path, type: e.type === 1 ? "storage" : "stream", size: e.size, start: e.start };
      this.entries.push(entry);
      const key = normalize(path);
      if (!this.byPath.has(key)) this.byPath.set(key, entry);
      if (e.type === 1) pushSiblings(e.child, path, depth + 1);
      this.budget.check();
    }
  }

  private readEntry(entry: CfbEntry): Uint8Array {
    const what = `OLE のストリーム「${entry.path}」`;
    this.budget.ensurePartSize(entry.size, what);
    let out: Uint8Array;
    if (entry.size < this.miniCutoff) {
      const mini = this.loadMiniStream();
      const count = Math.floor(mini.stream.length / MINI_SECTOR);
      out = this.readChain(entry.start, mini.fat, count, (s) => s * MINI_SECTOR, MINI_SECTOR, entry.size, mini.stream);
    } else {
      out = this.readChain(entry.start, this.fat, this.sectorCount, (s) => this.sectorOffset(s), this.sectorSize, entry.size);
    }
    this.budget.consume(out.length, what);
    return out;
  }

  private loadMiniStream(): { fat: Uint32Array; stream: Uint8Array } {
    if (!this.miniFat || !this.miniStream) {
      const root = this.entries[0];
      this.budget.ensurePartSize(root.size, "OLE のミニストリーム");
      const fatBytes =
        this.firstMiniFat <= MAXREGSECT
          ? this.readChain(this.firstMiniFat, this.fat, this.sectorCount, (s) => this.sectorOffset(s), this.sectorSize)
          : new Uint8Array();
      const fat = new Uint32Array(Math.floor(fatBytes.length / 4));
      const view = new DataView(fatBytes.buffer, fatBytes.byteOffset, fatBytes.byteLength);
      for (let i = 0; i < fat.length; i++) fat[i] = view.getUint32(i * 4, true);
      this.miniFat = fat;
      this.miniStream =
        root.start <= MAXREGSECT && root.size > 0
          ? this.readChain(root.start, this.fat, this.sectorCount, (s) => this.sectorOffset(s), this.sectorSize, root.size)
          : new Uint8Array();
      this.budget.consume(this.miniStream.length, "OLE のミニストリーム");
    }
    return { fat: this.miniFat, stream: this.miniStream };
  }
}

function normalize(path: string): string {
  return path.replace(/^\/+/, "").replace(/^Root Entry\//i, "").toUpperCase();
}

export function isCompoundFile(data: Uint8Array): boolean {
  return SIGNATURE.every((b, i) => data[i] === b);
}

export function readCompoundFile(data: Uint8Array, budget?: Budget): CompoundFile {
  return new CompoundFile(data, budget);
}
