import type { GameState, NpcStore, PackedArray, PackedNpcStore, SerializedGameState } from '../shared';

type Ctor = Uint8ArrayConstructor | Uint16ArrayConstructor | Int32ArrayConstructor | Uint32ArrayConstructor | Float32ArrayConstructor;
type TA = Uint8Array | Uint16Array | Int32Array | Uint32Array | Float32Array;

const CTORS: Record<PackedArray['type'], Ctor> = {
  u8: Uint8Array, u16: Uint16Array, i32: Int32Array, u32: Uint32Array, f32: Float32Array,
};

function typeOf(a: TA): PackedArray['type'] {
  if (a instanceof Uint8Array) return 'u8';
  if (a instanceof Uint16Array) return 'u16';
  if (a instanceof Int32Array) return 'i32';
  if (a instanceof Uint32Array) return 'u32';
  return 'f32';
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Little-endian байти typed array (усі цільові платформи — LE). */
export function packArray(a: TA): PackedArray {
  return { type: typeOf(a), length: a.length, base64: toBase64(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)) };
}

export function unpackArray(p: PackedArray): TA {
  const C = CTORS[p.type];
  if (!C) throw new Error(`Невідомий тип масиву: ${p.type}`);
  const bytes = fromBase64(p.base64);
  if (bytes.length !== p.length * C.BYTES_PER_ELEMENT) throw new Error('Пошкоджений масив у сейві');
  const copy = new Uint8Array(bytes.length); // вирівняний власний буфер
  copy.set(bytes);
  return new C(copy.buffer);
}

const NPC_ARRAYS = [
  'alive', 'sector', 'x', 'y', 'profession', 'task', 'targetBuilding', 'owner', 'hp', 'level',
  'inventory', 'equipment', 'carryKind', 'carryAmount',
] as const;

export function packState(s: GameState): SerializedGameState {
  const npcs = { capacity: s.npcs.capacity, count: s.npcs.count } as Record<string, unknown>;
  for (const k of NPC_ARRAYS) npcs[k] = packArray(s.npcs[k] as TA);
  return { ...s, npcs: npcs as unknown as PackedNpcStore };
}

export function unpackState(s: SerializedGameState): GameState {
  const npcs = { capacity: s.npcs.capacity, count: s.npcs.count } as Record<string, unknown>;
  for (const k of NPC_ARRAYS) npcs[k] = unpackArray(s.npcs[k]);
  return { ...s, npcs: npcs as unknown as NpcStore };
}
