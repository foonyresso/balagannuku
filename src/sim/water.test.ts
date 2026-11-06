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

describe('вода (озера й річки)', () => {
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
