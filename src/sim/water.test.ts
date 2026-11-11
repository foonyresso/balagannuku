import { describe, expect, it } from 'vitest';
import type { PlayerState } from '../shared';
import { ACTIVE_MAX_TILE, ACTIVE_MIN_TILE, RESOURCE_KINDS, SECTOR_CELLS, SECTOR_SIZE, TILES_PER_CELL } from '../shared';
import { checkPlace, createWorld, getSectorRt, isWaterTile, shoreNear, startCity } from './index';
import { claimStart } from './worldgen';
import { fillWater, homeLake, nearestShore, waterAt, WATER } from './water';
import { findPath } from './path';

const mk = (id: string): PlayerState => ({
  id, nickname: id, token: id, color: 1, homeSector: null, ownedSectors: [],
  resources: Object.fromEntries(RESOURCE_KINDS.map((k) => [k, 0])) as PlayerState['resources'],
});
const CT = (SECTOR_CELLS >> 1) * TILES_PER_CELL + 2;

function components(m: Uint8Array, size: number) {
  const seen = new Uint8Array(m.length), out: { area: number; w: number; h: number }[] = [];
  for (let s0 = 0; s0 < m.length; s0++) {
    if (!m[s0] || seen[s0]) continue;
    const st = [s0]; seen[s0] = 1;
    let area = 0, x0 = size, x1 = 0, y0 = size, y1 = 0;
    while (st.length) {
      const i = st.pop()!, x = i % size, y = (i / size) | 0;
      area++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (const j of [i - 1, i + 1, i - size, i + size]) if (j >= 0 && j < m.length && m[j] && !seen[j]) { seen[j] = 1; st.push(j); }
    }
    out.push({ area, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  }
  return out;
}

describe('вода (кілька озер, без річок)', () => {
  it('води мало (< 3% активної зони), є, і лише кілька озер без річок', () => {
    const zone = (ACTIVE_MAX_TILE - ACTIVE_MIN_TILE) ** 2;
    for (const seed of [1, 5, 7, 42, 1234, 99991]) {
      const m = new Uint8Array(SECTOR_SIZE * SECTOR_SIZE);
      const n = fillWater(seed, m, SECTOR_SIZE);
      expect(n / zone).toBeLessThan(0.03);
      expect(n / zone).toBeGreaterThan(0.001);
      const big = components(m, SECTOR_SIZE).filter((c) => c.area >= 500);
      expect(big.length).toBeLessThanOrEqual(10);
      for (const c of big) expect(c.area / (c.w * c.h)).toBeGreaterThan(0.3); // річка — тонка звивиста смуга з малою заповненістю рамки
    }
  });
  it('детермінована за seed', () => {
    const a = new Uint8Array(SECTOR_SIZE * SECTOR_SIZE), b = new Uint8Array(a.length), c = new Uint8Array(a.length);
    fillWater(77, a, SECTOR_SIZE); fillWater(77, b, SECTOR_SIZE); fillWater(78, c, SECTOR_SIZE);
    const same = (x: Uint8Array, y: Uint8Array) => x.every((v, i) => v === y[i]);
    expect(same(a, b)).toBe(true);
    expect(same(a, c)).toBe(false);
  });
  it('fillWater збігається з waterAt (безшовно, без залежності від меж)', () => {
    const m = new Uint8Array(SECTOR_SIZE * SECTOR_SIZE);
    fillWater(9, m, SECTOR_SIZE);
    let bad = 0;
    for (let k = 0; k < 4000; k++) {
      const x = ACTIVE_MIN_TILE + ((k * 7919) % (ACTIVE_MAX_TILE - ACTIVE_MIN_TILE)), y = ACTIVE_MIN_TILE + ((k * 104729) % (ACTIVE_MAX_TILE - ACTIVE_MIN_TILE));
      if ((m[y * SECTOR_SIZE + x] === 1) !== waterAt(9, x, y)) bad++;
    }
    expect(bad).toBe(0);
  });
  it('біля ратуші води немає, поза активною зоною — теж, а домашнє озеро в досяжній відстані', () => {
    for (const seed of [1, 7, 42, 1234, 99991]) {
      for (let y = CT - 100; y <= CT + 100; y += 5) for (let x = CT - 100; x <= CT + 100; x += 5) expect(waterAt(seed, x, y)).toBe(false);
      expect(waterAt(seed, 10, 10)).toBe(false);
      const hl = homeLake(seed);
      expect(waterAt(seed, Math.round(hl.x), Math.round(hl.y))).toBe(true);
      expect(Math.hypot(hl.x - CT, hl.y - CT) / TILES_PER_CELL).toBeLessThan(WATER.homeDist + 1);
      expect(hl.x - hl.r).toBeGreaterThan(ACTIVE_MIN_TILE);
      expect(hl.x + hl.r).toBeLessThan(ACTIVE_MAX_TILE);
    }
  });
  const w = createWorld(5, [mk('p')]);
  claimStart(w.state, 'p', 0);
  startCity(w, 'p');
  const rt = getSectorRt(w, 0);
  const hl = homeLake(5);
  it('на воді будувати не можна, вона непрохідна, є берег поблизу озера', () => {
    const wx = Math.round(hl.x), wy = Math.round(hl.y);
    expect(isWaterTile(w, 0, wx, wy)).toBe(true);
    expect(rt.occ[wy * SECTOR_SIZE + wx]).toBe(1);
    expect(checkPlace(w, 0, 'house', wx, wy)).toBe('occupied');
    const s = shoreNear(w, 0, wx, wy, 200)!;
    expect(s).not.toBeNull();
    expect(isWaterTile(w, 0, s.x, s.y)).toBe(false);
    expect(isWaterTile(w, 0, s.waterX, s.waterY)).toBe(true);
    expect(Math.abs(s.x - s.waterX) + Math.abs(s.y - s.waterY)).toBe(1);
    expect(nearestShore({ water: new Uint8Array(100), occ: new Uint8Array(100) }, 10, 5, 5, 4)).toBeNull();
  });
  it('шлях не проходить через центр озера (клітинка заблокована)', () => {
    const cx = Math.round(hl.x / TILES_PER_CELL), cy = Math.round(hl.y / TILES_PER_CELL), C = SECTOR_CELLS;
    expect(rt.blocked1[cy * C + cx]).toBe(1);
    expect(rt.blocked2[cy * C + cx]).toBe(1);
    let l = cx - 1, r = cx + 1;
    while (rt.blocked2[cy * C + l] && cx - l < 60) l--;
    while (rt.blocked2[cy * C + r] && r - cx < 60) r++;
    const p = findPath({ blocked: rt.blocked2, cellStage: rt.cellStage, forest: rt.forest }, l, cy, r, cy);
    if (p) expect([...p].includes(cy * C + cx)).toBe(false); // якщо шлях є, він обходить воду
  });
});
