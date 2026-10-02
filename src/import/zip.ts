// Minimal ZIP reader over a Blob. Reads the central directory and inflates entries on demand,
// so a large deck file never has to be held in memory all at once.
import { inflateSync } from 'fflate';
import { decompress as zstdDecompress } from 'fzstd';

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

export interface BlobLike {
  size: number;
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> };
}

async function read(blob: BlobLike, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const u64 = (b: Uint8Array, o: number) => u32(b, o) + u32(b, o + 4) * 2 ** 32;

export class ZipReader {
  private constructor(
    private blob: BlobLike,
    readonly entries: Map<string, ZipEntry>,
  ) {}

  static async open(file: BlobLike): Promise<ZipReader> {
    // Files up to 256 MB are read once into memory (many small slices are slow on mobile);
    // bigger ones are read piecemeal so they never need to fit in memory.
    const blob: BlobLike = file.size <= 256 * 1024 * 1024 ? memoryBlob(new Uint8Array(await file.slice(0, file.size).arrayBuffer())) : file;
    const tailLen = Math.min(blob.size, 65_557 + 20);
    const tail = await read(blob, blob.size - tailLen, blob.size);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (u32(tail, i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('This file isn’t a valid deck package (no ZIP directory found).');
    let count = u16(tail, eocd + 10);
    let cdSize = u32(tail, eocd + 12);
    let cdOffset = u32(tail, eocd + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      const loc = eocd - 20;
      if (loc >= 0 && u32(tail, loc) === 0x07064b50) {
        const z64Offset = u64(tail, loc + 8);
        const z = await read(blob, z64Offset, z64Offset + 56);
        if (u32(z, 0) === 0x06064b50) {
          count = u64(z, 32);
          cdSize = u64(z, 40);
          cdOffset = u64(z, 48);
        }
      }
    }
    const cd = await read(blob, cdOffset, cdOffset + cdSize);
    const entries = new Map<string, ZipEntry>();
    let p = 0;
    const dec = new TextDecoder();
    for (let n = 0; n < count && p + 46 <= cd.length; n++) {
      if (u32(cd, p) !== 0x02014b50) break;
      const method = u16(cd, p + 10);
      let compressedSize = u32(cd, p + 20);
      let size = u32(cd, p + 24);
      const nameLen = u16(cd, p + 28);
      const extraLen = u16(cd, p + 30);
      const commentLen = u16(cd, p + 32);
      let localOffset = u32(cd, p + 42);
      const name = dec.decode(cd.subarray(p + 46, p + 46 + nameLen));
      // zip64 extra field
      let e = p + 46 + nameLen;
      const eEnd = e + extraLen;
      while (e + 4 <= eEnd) {
        const id = u16(cd, e);
        const len = u16(cd, e + 2);
        if (id === 0x0001) {
          let q = e + 4;
          if (size === 0xffffffff) (size = u64(cd, q)), (q += 8);
          if (compressedSize === 0xffffffff) (compressedSize = u64(cd, q)), (q += 8);
          if (localOffset === 0xffffffff) localOffset = u64(cd, q);
        }
        e += 4 + len;
      }
      entries.set(name, { name, method, compressedSize, size, localOffset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return new ZipReader(blob, entries);
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  async read(name: string): Promise<Uint8Array> {
    const e = this.entries.get(name);
    if (!e) throw new Error(`Missing ${name} in package.`);
    const head = await read(this.blob, e.localOffset, e.localOffset + 30);
    if (u32(head, 0) !== 0x04034b50) throw new Error(`Corrupt entry ${name}.`);
    const dataStart = e.localOffset + 30 + u16(head, 26) + u16(head, 28);
    const raw = await read(this.blob, dataStart, dataStart + e.compressedSize);
    switch (e.method) {
      case 0:
        return raw;
      case 8:
        return inflateSync(raw, { out: new Uint8Array(e.size) });
      case 93:
        return zstdDecompress(raw);
      default:
        throw new Error(`Unsupported compression method ${e.method} for ${name}.`);
    }
  }
}

/** Zstandard frames start with 28 B5 2F FD. */
export function isZstd(b: Uint8Array): boolean {
  return b.length >= 4 && b[0] === 0x28 && b[1] === 0xb5 && b[2] === 0x2f && b[3] === 0xfd;
}

export function maybeZstd(b: Uint8Array): Uint8Array {
  return isZstd(b) ? zstdDecompress(b) : b;
}

function memoryBlob(bytes: Uint8Array): BlobLike {
  return {
    size: bytes.length,
    slice: (start: number, end: number) => ({
      arrayBuffer: async () => bytes.slice(start, end).buffer as ArrayBuffer,
    }),
  };
}
