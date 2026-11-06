import { describe, expect, it } from 'vitest';
import { RESOURCE_KINDS, SECTOR_SIZE, type PlayerState } from '../shared';
import { applyCommand, checkPlace, createWorld, getSectorRt, spawnNpc, staffBuilding, stepWorld, type SimWorld } from './index';
import { mulberry32 } from './rng';

const player: PlayerState = {
  id: 'p', nickname: 'p', token: 'p', color: 1, homeSector: 0, ownedSectors: [],
  resources: Object.fromEntries(RESOURCE_KINDS.map((k) => [k, 0])) as PlayerState['resources'],
};

/** Світ із `total` працівниками, розкиданими по `sectors` секторах (по ~total/sectors на сектор). */
function build(total: number, sectors: number): SimWorld {
  const w = createWorld(42, [{ ...player, ownedSectors: [] }]);
  w.freeBuild = true;
  const rnd = mulberry32(1);
  const perSector = Math.ceil(total / sectors);
  for (let s = 0; s < sectors; s++) {
    w.state.sectors[s].owner = 'p';
    getSectorRt(w, s);
    const put = (kind: 'warehouse' | 'lumberjack' | 'quarry' | 'sawmill') => {
      for (let t = 0; t < 2000; t++) {
        const x = Math.floor(rnd() * (SECTOR_SIZE - 14)), y = Math.floor(rnd() * (SECTOR_SIZE - 14));
        if (checkPlace(w, s, kind, x, y) !== null) continue;
        if (applyCommand(w, { player: 'p', seq: 0, cmd: { type: 'place_building', kind, sector: s, cell: { x, y } } }).ok) {
          return w.state.buildings[w.state.buildings.length - 1];
        }
      }
      throw new Error('немає місця');
    };
    const wh = put('warehouse');
    w.state.buildings[w.state.buildings.length - 1].stock = { wood: 300 };
    const lj = Math.ceil((perSector * 0.4) / 2), qr = Math.ceil((perSector * 0.3) / 4), sm = Math.ceil((perSector * 0.3) / 2); // за слотами
    const jobs = [...Array(lj).fill('lumberjack'), ...Array(qr).fill('quarry'), ...Array(sm).fill('sawmill')] as ('lumberjack' | 'quarry' | 'sawmill')[];
    const made = jobs.map((k) => put(k));
    for (let k = 0; k < perSector && w.state.npcs.count < total; k++) spawnNpc(w, 0, s, wh.entrance.x, wh.entrance.y);
    for (const b of made) staffBuilding(w, 'p', b.id);
  }
  return w;
}

function bench(total: number, sectors: number, ticks: number) {
  const w = build(total, sectors);
  for (let i = 0; i < 50; i++) stepWorld(w); // прогрів
  const t0 = performance.now();
  for (let i = 0; i < ticks; i++) stepWorld(w);
  const ms = (performance.now() - t0) / ticks;
  const working = w.npc.workplace.reduce((a, v) => a + (v >= 0 ? 1 : 0), 0);
  console.log(`[bench] ${w.state.npcs.count} NPC (${working} на роботі), ${sectors} секторів: ${ms.toFixed(2)} мс/тік (бюджет 100 мс при 10 Гц)`);
  return ms;
}

describe('бенчмарк симуляції', () => {
  it('4000 NPC в одному великому місті', () => { expect(bench(4000, 1, 100)).toBeLessThan(100); });
  it('500 NPC', () => { expect(bench(500, 4, 200)).toBeLessThan(100); });
  it('2000 NPC', () => { expect(bench(2000, 8, 200)).toBeLessThan(100); });
});

describe('бюджет великого сектора', () => {
  it('створення сектора (1024×1024 тайлів), згасання стежок і сериалізація вкладаються в бюджет', () => {
    const w = createWorld(42, [{ ...player, ownedSectors: [] }]);
    let t0 = performance.now();
    const rt = getSectorRt(w, 0);
    const create = performance.now() - t0;
    let nodes = 0;
    for (let i = 0; i < rt.kind.length; i++) if (rt.kind[i]) nodes++;
    t0 = performance.now();
    for (let i = 0; i < 50; i++) stepWorld(w); // включно з одним проходом згасання
    const steps = (performance.now() - t0) / 50;
    console.log(`[bench] сектор ${SECTOR_SIZE}²: створення ${create.toFixed(0)} мс, вузлів ${nodes}, ${steps.toFixed(2)} мс/тік`);
    expect(create).toBeLessThan(1500);
    expect(steps).toBeLessThan(50);
  });
});
