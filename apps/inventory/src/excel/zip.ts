// zip(OOXML のパッケージ)の読み取り。中央ディレクトリだけを先に読み、中身は必要になった部品だけを展開する。
// zip 爆弾対策として、エントリ数・宣言された展開後サイズ・実際に展開したサイズ・合計を Budget で制限し、
// 展開は小さな単位で少しずつ行って、宣言より大きく展開されたらその時点で止める。
import { Inflate } from "fflate";
import { CorruptFileError, InventoryError, LimitExceededError } from "../errors";
import { Budget } from "../limits";

interface ZipEntry {
  name: string;
  flags: number;
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

const INPUT_CHUNK = 16 * 1024;

const corrupt = (detail: string) => new CorruptFileError(`zip 形式のファイルとして読めません(${detail})`);

export class ZipArchive {
  private readonly entries = new Map<string, ZipEntry>();
  private readonly cache = new Map<string, Uint8Array | null>();
  private readonly view: DataView;

  constructor(
    private readonly data: Uint8Array,
    private readonly budget: Budget = new Budget(),
  ) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.readCentralDirectory();
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  has(name: string): boolean {
    return this.entries.has(normalize(name));
  }

  /** 部品を展開して返す。無い・暗号化・未対応の圧縮方式なら null */
  read(name: string): Uint8Array | null {
    const key = normalize(name);
    if (this.cache.has(key)) return this.cache.get(key)!;
    const entry = this.entries.get(key);
    const result = entry ? this.extract(entry) : null;
    this.cache.set(key, result);
    return result;
  }

  private u16(at: number): number {
    if (at + 2 > this.data.length) throw corrupt("レコードが途中で切れています");
    return this.view.getUint16(at, true);
  }

  private u32(at: number): number {
    if (at + 4 > this.data.length) throw corrupt("レコードが途中で切れています");
    return this.view.getUint32(at, true);
  }

  private u64(at: number): number {
    return this.u32(at) + this.u32(at + 4) * 2 ** 32;
  }

  private readCentralDirectory() {
    const eocd = this.findEndOfCentralDirectory();
    let count = this.u16(eocd + 10);
    let cdOffset = this.u32(eocd + 16);
    if (count === 0xffff || cdOffset === 0xffffffff) {
      // ZIP64
      const locator = eocd - 20;
      if (locator >= 0 && this.u32(locator) === 0x07064b50) {
        const z = this.u64(locator + 8);
        if (this.u32(z) !== 0x06064b50) throw corrupt("ZIP64 の終端レコードが不正です");
        count = this.u64(z + 32);
        cdOffset = this.u64(z + 48);
      }
    }
    if (count > this.budget.limits.maxZipEntries) {
      throw new LimitExceededError(
        "entryCount",
        `zip 内のファイル数(${count})が上限(${this.budget.limits.maxZipEntries})を超えるため、解析を中止しました。ファイルが壊れているか、Excel のファイルではない可能性があります。`,
      );
    }
    let pos = cdOffset;
    for (let i = 0; i < count; i++) {
      if (this.u32(pos) !== 0x02014b50) throw corrupt("中央ディレクトリのレコードが不正です");
      const flags = this.u16(pos + 8);
      const method = this.u16(pos + 10);
      let compressedSize = this.u32(pos + 20);
      let size = this.u32(pos + 24);
      const nameLength = this.u16(pos + 28);
      const extraLength = this.u16(pos + 30);
      const commentLength = this.u16(pos + 32);
      let localOffset = this.u32(pos + 42);
      const nameStart = pos + 46;
      if (nameStart + nameLength + extraLength > this.data.length) throw corrupt("ファイル名が途中で切れています");
      const nameBytes = this.data.subarray(nameStart, nameStart + nameLength);
      const name = flags & 0x800 ? new TextDecoder().decode(nameBytes) : String.fromCharCode(...nameBytes);
      // ZIP64 の拡張フィールド(0xFFFFFFFF になっている値だけがこの順で入る)
      let extra = nameStart + nameLength;
      const extraEnd = extra + extraLength;
      while (extra + 4 <= extraEnd) {
        const id = this.u16(extra);
        const len = this.u16(extra + 2);
        if (id === 0x0001) {
          let p = extra + 4;
          const fieldEnd = extra + 4 + len;
          if (size === 0xffffffff && p + 8 <= fieldEnd) {
            size = this.u64(p);
            p += 8;
          }
          if (compressedSize === 0xffffffff && p + 8 <= fieldEnd) {
            compressedSize = this.u64(p);
            p += 8;
          }
          if (localOffset === 0xffffffff && p + 8 <= fieldEnd) localOffset = this.u64(p);
        }
        extra += 4 + len;
      }
      const key = normalize(name);
      if (!this.entries.has(key)) this.entries.set(key, { name, flags, method, compressedSize, size, localOffset });
      pos = extraEnd + commentLength;
      this.budget.check();
    }
  }

  private findEndOfCentralDirectory(): number {
    const min = Math.max(0, this.data.length - 22 - 0xffff);
    for (let e = this.data.length - 22; e >= min; e--) {
      if (this.data[e] === 0x50 && this.data[e + 1] === 0x4b && this.data[e + 2] === 0x05 && this.data[e + 3] === 0x06) return e;
    }
    throw corrupt("終端レコードが見つかりません");
  }

  private extract(entry: ZipEntry): Uint8Array | null {
    if (entry.flags & 0x01) return null; // 暗号化されたエントリ
    if (entry.method !== 0 && entry.method !== 8) return null;
    const what = `zip 内の「${entry.name}」`;
    this.budget.ensurePartSize(entry.size, what);
    const local = entry.localOffset;
    if (this.u32(local) !== 0x04034b50) throw corrupt(`「${entry.name}」のローカルヘッダが不正です`);
    const start = local + 30 + this.u16(local + 26) + this.u16(local + 28);
    const end = Math.min(this.data.length, start + entry.compressedSize);
    if (start > this.data.length) throw corrupt(`「${entry.name}」の位置がファイルの外を指しています`);
    const src = this.data.subarray(start, end);

    if (entry.method === 0) {
      const out = src.slice(0, entry.size);
      this.budget.consume(out.length, what);
      return out;
    }

    // 宣言されたサイズを超えて展開されたら(zip 爆弾・壊れたファイル)止める
    const limit = entry.size;
    const chunks: Uint8Array[] = [];
    let total = 0;
    const inflate = new Inflate((chunk) => {
      total += chunk.length;
      if (total > limit) {
        throw new LimitExceededError(
          "partSize",
          `${what}が宣言されたサイズ(${limit}バイト)を超えて展開されるため、解析を中止しました。ファイルが壊れているか、zip 爆弾の可能性があります。`,
        );
      }
      chunks.push(chunk);
    });
    try {
      for (let p = 0; p === 0 || p < src.length; p += INPUT_CHUNK) {
        inflate.push(src.subarray(p, Math.min(src.length, p + INPUT_CHUNK)), p + INPUT_CHUNK >= src.length);
        this.budget.checkNow();
      }
    } catch (e) {
      if (e instanceof InventoryError) throw e;
      throw corrupt(`「${entry.name}」を展開できません: ${(e as Error).message}`);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    this.budget.consume(out.length, what);
    return out;
  }
}

function normalize(name: string): string {
  return name.replace(/^\/+/, "").toLowerCase();
}
