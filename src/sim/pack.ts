import type { PackedArray } from '../shared';

type Typed = Uint8Array | Uint16Array | Int32Array | Uint32Array | Float32Array;
const TYPE_OF: Record<string, PackedArray['type']> = {
  Uint8Array: 'u8', Uint16Array: 'u16', Int32Array: 'i32', Uint32Array: 'u32', Float32Array: 'f32',
};
const CTOR = { u8: Uint8Array, u16: Uint16Array, i32: Int32Array, u32: Uint32Array, f32: Float32Array } as const;

/** typed array -> base64 сирих байтів (little-endian). */
export function pack(a: Typed): PackedArray {
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { type: TYPE_OF[a.constructor.name], length: a.length, base64: btoa(s) };
}

export function unpack<T extends Typed>(p: PackedArray): T {
  const s = atob(p.base64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  const C = CTOR[p.type];
  return new C(bytes.buffer, 0, p.length) as unknown as T;
}
