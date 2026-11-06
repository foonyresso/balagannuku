import { describe, expect, it } from 'vitest';
import type { PlayerState } from '../shared';
import { ACTIVE_MAX_TILE, ACTIVE_MIN_TILE, RESOURCE_KINDS, SECTOR_SIZE } from '../shared';
import { checkPlace, createWorld, getSectorRt, startCity } from './index';
import { claimStart } from './worldgen';

const mk = (id: string): PlayerState => ({
  id, nickname: id, token: id, color: 1, homeSector: null, ownedSectors: [],
  resources: Object.fromEntries(RESOURCE_KINDS.map((k) => [k, 0])) as PlayerState['resources'],
});

describe('неактивна смуга карти', () => {
  const w = createWorld(3, [mk('p')]);
  claimStart(w.state, 'p', 0);
  startCity(w, 'p');
  const rt = getSectorRt(w, 0);
  it('будувати у смузі й на її межі заборонено, всередині активної зони — можна', () => {
    expect(checkPlace(w, 0, 'house', 4, 4)).toBe('invalid');
    expect(checkPlace(w, 0, 'house', ACTIVE_MIN_TILE - 1, ACTIVE_MIN_TILE + 50)).toBe('invalid');
    expect(checkPlace(w, 0, 'house', ACTIVE_MAX_TILE - 1, ACTIVE_MIN_TILE + 50)).toBe('invalid');
    expect(checkPlace(w, 0, 'house', SECTOR_SIZE - 3, SECTOR_SIZE - 3)).toBe('invalid');
  });
  it('смуга непрохідна (occ), у ній немає ресурсів для симуляції', () => {
    expect(rt.occ[10 * SECTOR_SIZE + 10]).toBe(1);
    expect(rt.occ[(ACTIVE_MIN_TILE + 5) * SECTOR_SIZE + ACTIVE_MIN_TILE + 5]).toBe(0);
    for (let i = 0; i < 64 * 828; i++) expect(rt.kind[i]).toBe(0);
  });
});
