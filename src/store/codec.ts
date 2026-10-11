/**
 * A lossless text encoding for stored values (NFR-STO-002, NFR-STO-003).
 * IndexedDB keeps bigint, typed arrays and undefined through structured
 * clone; encrypting or exporting a record needs bytes, so those are tagged
 * inside JSON. A plain object that happens to have a `$t` key is tagged too,
 * so decoding never misreads user data.
 */

type Tagged =
  | { $t: 'big'; v: string }
  | { $t: 'u8'; v: string }
  | { $t: 'undef' }
  | { $t: 'obj'; v: Record<string, unknown> };

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function tag(v: unknown): unknown {
  if (typeof v === 'bigint') return { $t: 'big', v: v.toString() } satisfies Tagged;
  if (v === undefined) return { $t: 'undef' } satisfies Tagged;
  if (v instanceof Uint8Array) return { $t: 'u8', v: toBase64(v) } satisfies Tagged;
  if (Array.isArray(v)) return v.map(tag);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = tag(x);
    return '$t' in o ? ({ $t: 'obj', v: o } satisfies Tagged) : o;
  }
  return v;
}

function untag(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(untag);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('$t' in o) {
      const t = o as Tagged;
      switch (t.$t) {
        case 'big':
          return BigInt(t.v);
        case 'u8':
          return fromBase64(t.v);
        case 'undef':
          return undefined;
        case 'obj':
          return Object.fromEntries(Object.entries(t.v).map(([k, x]) => [k, untag(x)]));
      }
    }
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, untag(x)]));
  }
  return v;
}

export function encode(value: unknown): string {
  return JSON.stringify(tag(value));
}

export function decode<T = unknown>(text: string): T {
  return untag(JSON.parse(text)) as T;
}
