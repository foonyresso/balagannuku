import type { HexCoord } from '../shared';

/** Гекси pointy-top, осьові координати (q, r). */
export const HEX_DIRS: readonly HexCoord[] = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 }, { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

export function hexDistance(a: HexCoord, b: HexCoord): number {
  const dq = a.q - b.q, dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Усі гекси в радіусі `radius` від (0,0), за спіраллю рядків. */
export function hexDisc(radius: number): HexCoord[] {
  const out: HexCoord[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) out.push({ q, r });
  }
  return out;
}

/** Центр гекса в піксельних координатах (size — радіус гекса). */
export function hexToPixel(h: HexCoord, size: number): { x: number; y: number } {
  return { x: size * Math.sqrt(3) * (h.q + h.r / 2), y: size * 1.5 * h.r };
}

/** Піксель -> найближчий гекс. */
export function pixelToHex(x: number, y: number, size: number): HexCoord {
  const q = ((Math.sqrt(3) / 3) * x - (1 / 3) * y) / size;
  const r = ((2 / 3) * y) / size;
  return hexRound(q, r);
}

function hexRound(qf: number, rf: number): HexCoord {
  const sf = -qf - rf;
  let q = Math.round(qf), r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q: q + 0, r: r + 0 };
}
