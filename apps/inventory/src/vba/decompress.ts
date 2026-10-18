// [MS-OVBA] 2.4.1 Compression and Decompression の解凍側の実装。

export class VbaFormatError extends Error {}

const CHUNK_SIZE = 4096;

/** CompressedContainer を解凍する。offset は SignatureByte (0x01) の位置。 */
export function decompressContainer(data: Uint8Array, offset = 0): Uint8Array {
  if (data[offset] !== 0x01) {
    throw new VbaFormatError(
      `圧縮コンテナの署名が不正です(offset=${offset}, byte=${data[offset]})`,
    );
  }
  let out = new Uint8Array(Math.max(CHUNK_SIZE, (data.length - offset) * 3));
  let outLen = 0;
  const ensure = (extra: number) => {
    if (outLen + extra <= out.length) return;
    const next = new Uint8Array(Math.max(out.length * 2, outLen + extra));
    next.set(out.subarray(0, outLen));
    out = next;
  };

  let pos = offset + 1;
  while (pos + 2 <= data.length) {
    const header = data[pos] | (data[pos + 1] << 8);
    const chunkSize = (header & 0x0fff) + 3;
    if (((header >> 12) & 0x07) !== 0b011) {
      throw new VbaFormatError(`チャンクヘッダの署名が不正です(pos=${pos})`);
    }
    const chunkEnd = Math.min(pos + chunkSize, data.length);
    pos += 2;
    const chunkStart = outLen;

    if ((header & 0x8000) === 0) {
      // 非圧縮チャンク: 常に 4096 バイト
      const raw = data.subarray(pos, Math.min(pos + CHUNK_SIZE, data.length));
      ensure(raw.length);
      out.set(raw, outLen);
      outLen += raw.length;
      pos += CHUNK_SIZE;
      continue;
    }

    while (pos < chunkEnd) {
      const flags = data[pos++];
      for (let bit = 0; bit < 8 && pos < chunkEnd; bit++) {
        if ((flags & (1 << bit)) === 0) {
          ensure(1);
          out[outLen++] = data[pos++];
          continue;
        }
        if (pos + 2 > chunkEnd) {
          throw new VbaFormatError(`CopyToken が途中で切れています(pos=${pos})`);
        }
        const token = data[pos] | (data[pos + 1] << 8);
        pos += 2;
        const { offset: back, length } = unpackCopyToken(token, outLen - chunkStart);
        if (back > outLen - chunkStart) {
          throw new VbaFormatError(`CopyToken の参照先が不正です(pos=${pos})`);
        }
        ensure(length);
        for (let i = 0; i < length; i++) {
          out[outLen] = out[outLen - back];
          outLen++;
        }
      }
    }
    pos = chunkEnd;
  }
  return out.slice(0, outLen);
}

/** 2.4.1.3.19.1 CopyToken Help: 解凍済みチャンク内の位置からビット数を決める */
export function copyTokenBitCount(difference: number): number {
  let bitCount = 4;
  while (1 << bitCount < difference) bitCount++;
  return bitCount;
}

export function unpackCopyToken(token: number, difference: number) {
  const bitCount = copyTokenBitCount(difference);
  const lengthMask = 0xffff >> bitCount;
  const offsetMask = ~lengthMask & 0xffff;
  return {
    length: (token & lengthMask) + 3,
    offset: ((token & offsetMask) >> (16 - bitCount)) + 1,
  };
}
