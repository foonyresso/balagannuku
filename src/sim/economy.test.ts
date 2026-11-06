import { describe, expect, it } from 'vitest';
import type { PlayerState } from '../shared';
import { RESOURCE_KINDS, SECTOR_SIZE, TrailStage } from '../shared';
import { applyCommand, createWorld, getSectorRt, deserialize, serialize, startCity, staffBuilding, stepWorld, type SimWorld } from './index';
import { claimStart } from './worldgen';

const mk = (id: string): PlayerState => ({
  id, nickname: id, token: id, color: 1, homeSector: null, ownedSectors: [],
  resources: Object.fromEntries(RESOURCE_KINDS.map((k) => [k, 0])) as PlayerState['resources'],
});

export function setup(seed = 7): SimWorld {
  const w = createWorld(seed, [mk('p')]);
  expect(claimStart(w.state, 'p', 0).ok).toBe(true);
  startCity(w, 'p');
  return w;
}
const free = (w: SimWorld, x0: number, y0: number) => {
  const rt = getSectorRt(w, 0);
  let x = x0, y = y0, bd = Infinity;
  for (let yy = 1; yy < SECTOR_SIZE - 2; yy++) for (let xx = 1; xx < SECTOR_SIZE - 1; xx++) {
    const i = yy * SECTOR_SIZE + xx, j = i + SECTOR_SIZE;
    if (rt.blocked[i] || rt.blocked[j] || rt.kind[i] || rt.kind[j]) continue;
    const d = Math.abs(xx - x0) + Math.abs(yy - y0);
    if (d < bd) { bd = d; x = xx; y = yy; }
  }
  return { x, y };
};
const place = (w: SimWorld, kind: 'lumberjack' | 'quarry' | 'sawmill' | 'warehouse' | 'house', x0: number, y0: number) => {
  const { x, y } = free(w, x0, y0);
  const r = applyCommand(w, { player: 'p', seq: 1, cmd: { type: 'place_building', kind, sector: 0, cell: { x, y } } });
  expect(r.ok, String(r.reason)).toBe(true);
  return w.state.buildings[w.state.buildings.length - 1];
};
const run = (w: SimWorld, t: number) => { for (let i = 0; i < t; i++) stepWorld(w); };
const hall = (w: SimWorld) => w.state.buildings[0];

describe('економіка', () => {
  it('ланцюжок: лісоруб -> склад -> лісопильня -> дошки', () => {
    const w = setup();
    const lj = place(w, 'lumberjack', 36, 30);
    const sm = place(w, 'sawmill', 28, 30);
    staffBuilding(w, 'p', lj.id, 3);
    staffBuilding(w, 'p', sm.id, 2);
    expect(lj.workers.length + sm.workers.length).toBe(5);
    const wood0 = hall(w).stock.wood ?? 0, planks0 = hall(w).stock.planks ?? 0;
    run(w, 800);
    const f = w.state.flows.total;
    expect(f.byBuilding[lj.id].produced.wood).toBeGreaterThan(5);
    expect(f.byBuilding[sm.id].produced.planks).toBeGreaterThan(0);
    expect(f.byBuilding[sm.id].consumed.wood).toBe((f.byBuilding[sm.id].produced.planks ?? 0) * 2);
    expect(hall(w).stock.planks ?? 0).toBeGreaterThan(planks0);
    expect(f.edges[`${lj.id}>${hall(w).id}:wood`]).toBeGreaterThan(0);
    expect(f.edges[`${hall(w).id}>${sm.id}:wood`]).toBeGreaterThan(0);
    expect(wood0).toBeGreaterThan(0);
  });

  it('камінь: кар’єр -> склад', () => {
    const w = setup();
    const q = place(w, 'quarry', 30, 40);
    staffBuilding(w, 'p', q.id);
    run(w, 1200);
    expect(w.state.flows.total.byBuilding[q.id]?.produced.stone ?? 0).toBeGreaterThan(0);
  });

  it('команди: відмови без ресурсів, зайнята клітинка, чужі', () => {
    const w = setup();
    place(w, 'warehouse', 20, 20);
    const occ = applyCommand(w, { player: 'p', seq: 2, cmd: { type: 'place_building', kind: 'warehouse', sector: 0, cell: { x: w.state.buildings[1].cell.x, y: w.state.buildings[1].cell.y } } });
    expect(occ.reason).toBe('occupied');
    w.state.buildings.forEach((b) => (b.stock = {}));
    const poor = applyCommand(w, { player: 'p', seq: 3, cmd: { type: 'place_building', kind: 'warehouse', sector: 0, cell: free(w, 10, 10) } });
    expect(poor.reason).toBe('no_resources');
    const alien = applyCommand(w, { player: 'x', seq: 4, cmd: { type: 'place_building', kind: 'warehouse', sector: 0, cell: free(w, 10, 10) } });
    expect(alien.reason).toBe('not_owner');
  });

  it('стежки: трафік росте, стадія підіймається, потім згасає', () => {
    const w = setup();
    const lj = place(w, 'lumberjack', 36, 30);
    staffBuilding(w, 'p', lj.id);
    run(w, 1500);
    const rt = w.sectors.get(0)!;
    const max = Math.max(...rt.trails.traffic);
    expect(max).toBeGreaterThan(20);
    expect(rt.stage.some((s) => s >= TrailStage.Trampled)).toBe(true);
    for (const id of [...lj.workers]) applyCommand(w, { player: 'p', seq: 5, cmd: { type: 'unassign_worker', npc: id } });
    run(w, 2000);
    expect(Math.max(...rt.trails.traffic)).toBeLessThan(max);
  });

  it('серіалізація: round-trip зберігає стан і далі працює', () => {
    const w = setup();
    const lj = place(w, 'lumberjack', 36, 30);
    staffBuilding(w, 'p', lj.id);
    run(w, 300);
    const json = JSON.parse(JSON.stringify(serialize(w)));
    const w2 = deserialize(json);
    expect(w2.state.tick).toBe(w.state.tick);
    expect(w2.state.buildings.length).toBe(w.state.buildings.length);
    expect(Array.from(w2.sectors.get(0)!.trails.traffic)).toEqual(Array.from(w.sectors.get(0)!.trails.traffic));
    run(w2, 300);
    expect(w2.state.flows.total.byBuilding[lj.id].produced.wood).toBeGreaterThan(w.state.flows.total.byBuilding[lj.id].produced.wood ?? 0);
  });

  it('детермінізм: той самий seed і команди -> той самий стан', () => {
    const go = () => {
      const w = setup(11);
      staffBuilding(w, 'p', place(w, 'lumberjack', 36, 30).id);
      run(w, 400);
      return JSON.stringify(serialize(w));
    };
    expect(go()).toBe(go());
  });

  it('будинок додає населення', () => {
    const w = setup();
    for (let k = 0; k < 2; k++) place(w, 'house', 20 + k * 2, 20);
    const before = w.state.npcs.count;
    run(w, 700);
    expect(w.state.npcs.count).toBeGreaterThan(before);
    expect(SECTOR_SIZE).toBe(64);
  });
});
