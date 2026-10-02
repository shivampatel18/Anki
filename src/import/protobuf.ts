// Just enough protobuf decoding to read Anki's schema-18 config blobs.

export type PbValue = number | Uint8Array;

export class PbMessage {
  constructor(readonly fields: Map<number, PbValue[]>) {}

  static decode(buf: Uint8Array): PbMessage {
    const fields = new Map<number, PbValue[]>();
    let p = 0;
    const varint = (): number => {
      let result = 0;
      let mul = 1;
      for (;;) {
        if (p >= buf.length) throw new Error('Truncated protobuf');
        const b = buf[p++];
        result += (b & 0x7f) * mul;
        if (!(b & 0x80)) return result;
        mul *= 128;
      }
    };
    while (p < buf.length) {
      const key = varint();
      const field = Math.floor(key / 8);
      const wire = key & 7;
      let v: PbValue;
      if (wire === 0) v = varint();
      else if (wire === 1) (v = buf.subarray(p, p + 8)), (p += 8);
      else if (wire === 2) {
        const len = varint();
        v = buf.subarray(p, p + len);
        p += len;
      } else if (wire === 5) (v = buf.subarray(p, p + 4)), (p += 4);
      else throw new Error(`Unsupported wire type ${wire}`);
      if (!fields.has(field)) fields.set(field, []);
      fields.get(field)!.push(v);
    }
    return new PbMessage(fields);
  }

  private last(n: number): PbValue | undefined {
    const a = this.fields.get(n);
    return a?.[a.length - 1];
  }

  int(n: number, d = 0): number {
    const v = this.last(n);
    return typeof v === 'number' ? v : d;
  }

  bool(n: number, d = false): boolean {
    const v = this.last(n);
    return typeof v === 'number' ? v !== 0 : d;
  }

  string(n: number, d = ''): string {
    const v = this.last(n);
    return v instanceof Uint8Array ? new TextDecoder().decode(v) : d;
  }

  bytes(n: number): Uint8Array | undefined {
    const v = this.last(n);
    return v instanceof Uint8Array ? v : undefined;
  }

  message(n: number): PbMessage | undefined {
    const b = this.bytes(n);
    return b ? PbMessage.decode(b) : undefined;
  }

  messages(n: number): PbMessage[] {
    return (this.fields.get(n) ?? []).filter((v): v is Uint8Array => v instanceof Uint8Array).map((b) => PbMessage.decode(b));
  }

  float(n: number, d = 0): number {
    const v = this.last(n);
    if (!(v instanceof Uint8Array) || v.length !== 4) return d;
    return new DataView(v.buffer, v.byteOffset, 4).getFloat32(0, true);
  }

  /** Repeated float, packed (wire type 2) or not. */
  floats(n: number): number[] {
    const out: number[] = [];
    for (const v of this.fields.get(n) ?? []) {
      if (!(v instanceof Uint8Array)) continue;
      const dv = new DataView(v.buffer, v.byteOffset, v.length);
      for (let i = 0; i + 4 <= v.length; i += 4) out.push(dv.getFloat32(i, true));
    }
    return out;
  }
}
