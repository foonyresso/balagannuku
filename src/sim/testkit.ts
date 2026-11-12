/** Спільні помічники тестів симуляції: компактний світ із містом, розміщення споруд, прогін тіків. Лише для *.test.ts. */
import { expect } from 'vitest';
import { type PlayerState, ACTIVE_MAX_TILE, ACTIVE_MIN_TILE, RESOURCE_KINDS, SECTOR_CELLS, SECTOR_SIZE } from '../shared';
import { checkPlace, applyCommand, createWorld, startCity, stepWorld, type SimWorld } from './index';
import { claimStart } from './worldgen';
import { COMPACT_NODEGEN, configureNodegen } from './nodegen';

export const mk = (id: string): PlayerState => ({
  id, nickname: id, token: id, color: 1, homeSector: null, ownedSectors: [],
  resources: Object.fromEntries(RESOURCE_KINDS.map((k) => [k, 0])) as PlayerState['resources'],
});

export function setup(seed = 7): SimWorld {
  configureNodegen(COMPACT_NODEGEN); // тести економіки йдуть у компактному світі (ресурси поруч з ратушею)
  const w = createWorld(seed, [mk('p')]);
  expect(claimStart(w.state, 'p', 0).ok).toBe(true);
  startCity(w, 'p');
  return w;
}
/** Координати тестів задані відносно центру колишнього 64-клітинкового сектора. */
/** Тайли неактивної смуги завжди зайняті. */
export const BORDER_OCC = SECTOR_SIZE * SECTOR_SIZE - (ACTIVE_MAX_TILE - ACTIVE_MIN_TILE) ** 2;
export const OFF = SECTOR_CELLS / 2 - 32;
export type Kind = 'lumberjack' | 'quarry' | 'sawmill' | 'warehouse' | 'farm' | 'hunter' | 'fisher' | 'house';
/** Найближчий до (x0,y0) тайл, де кind можна поставити (за checkPlace). */
export const free = (w: SimWorld, kind: Kind, x0: number, y0: number) => {
  let best = { x: x0, y: y0 }, bd = Infinity;
  for (let y = 0; y < SECTOR_SIZE; y += 2) for (let x = 0; x < SECTOR_SIZE; x += 2) {
    const d = Math.abs(x - x0) + Math.abs(y - y0);
    if (d < bd && checkPlace(w, 0, kind, x, y) === null) { bd = d; best = { x, y }; }
  }
  return best;
};
/** Координати (cx,cy) — у клітинках навігації; будівля ставиться в найближче вільне місце. */
export const place = (w: SimWorld, kind: Kind, cx: number, cy: number) => {
  const { x, y } = free(w, kind, (cx + OFF) * 4, (cy + OFF) * 4);
  const r = applyCommand(w, { player: 'p', seq: 1, cmd: { type: 'place_building', kind, sector: 0, cell: { x, y } } });
  expect(r.ok, String(r.reason)).toBe(true);
  return w.state.buildings[w.state.buildings.length - 1];
};
export const maxOf = (a: ArrayLike<number>): number => { let m = 0; for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i]; return m; };
export const run = (w: SimWorld, t: number) => { for (let i = 0; i < t; i++) stepWorld(w); };
export const hall = (w: SimWorld) => w.state.buildings[0];
export const idleOf = (w: SimWorld): number => w.state.npcs.alive.findIndex((a, i) => a === 1 && w.npc.workplace[i] < 0);
