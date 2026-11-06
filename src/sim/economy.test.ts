import { describe, expect, it } from 'vitest';
import type { PlayerState } from '../shared';
import { RESOURCE_KINDS, SECTOR_SIZE, TrailStage } from '../shared';
import { buildCheck, applyCommand, createWorld, getSectorRt, deserialize, serialize, startCity, staffBuilding, stepWorld, type SimWorld } from './index';
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
    expect((f.edges[`${hall(w).id}>${sm.id}:wood`] ?? 0) + (f.edges[`${lj.id}>${sm.id}:wood`] ?? 0)).toBeGreaterThan(0);
    expect(wood0).toBeGreaterThan(0);
  });

  it('камінь: кар’єр -> склад', () => {
    const w = setup();
    const q = place(w, 'quarry', 30, 40);
    staffBuilding(w, 'p', q.id);
    run(w, 1200);
    expect(w.state.flows.total.byBuilding[q.id]?.produced.stone ?? 0).toBeGreaterThan(0);
  });

  it('логістика: лісоруб несе колоди прямо на ближчу лісопилку, а не на склад', () => {
    const w = setup();
    const sm = place(w, 'sawmill', 33, 31);
    const lj = place(w, 'lumberjack', 36, 31);
    staffBuilding(w, 'p', lj.id, 2);
    staffBuilding(w, 'p', sm.id, 1);
    run(w, 600);
    const e = w.state.flows.total.edges;
    expect(e[`${lj.id}>${sm.id}:wood`] ?? 0).toBeGreaterThan(0);
    expect(sm.stock.wood ?? 0).toBeLessThanOrEqual(15);
  });

  it('логістика: повна лісопилка — колоди йдуть на склад', () => {
    const w = setup();
    const sm = place(w, 'sawmill', 33, 31);
    const lj = place(w, 'lumberjack', 36, 31);
    sm.stock.wood = 15;
    staffBuilding(w, 'p', lj.id, 2);
    run(w, 400);
    const e = w.state.flows.total.edges;
    expect(e[`${lj.id}>${sm.id}:wood`] ?? 0).toBe(0);
    expect(e[`${lj.id}>${hall(w).id}:wood`] ?? 0).toBeGreaterThan(0);
  });

  it('ресурси безкінечні: камінь не вичерпується, дерева відростають', () => {
    const w = setup();
    const rt = getSectorRt(w, 0);
    const stones = rt.kind.reduce((a, k) => a + (k === 2 ? 1 : 0), 0);
    const q = place(w, 'quarry', 30, 40);
    staffBuilding(w, 'p', q.id);
    run(w, 3000);
    const got = w.state.flows.total.byBuilding[q.id].produced.stone ?? 0;
    expect(stones).toBeGreaterThan(0);
    expect(got).toBeGreaterThan(100);
    const before = got;
    hall(w).stock.stone = 0; // склад був повний
    run(w, 600);
    expect(w.state.flows.total.byBuilding[q.id].produced.stone ?? 0).toBeGreaterThan(before);
    expect(rt.kind.reduce((a, k) => a + (k === 2 ? 1 : 0), 0)).toBe(stones); // вузли лишаються
  });

  it('тупик: багато лісопилень не блокують будівництво лісоруба (резерв + безкоштовний перший)', () => {
    const w = setup();
    // забагато лісопилень, лісоруба ще немає: перший лісоруб безкоштовний навіть без дерева
    hall(w).stock = { stone: 100, planks: 50, wood: 12 };
    w.freeBuild = true;
    for (let k = 0; k < 4; k++) staffBuilding(w, 'p', place(w, 'sawmill', 24 + k * 3, 24).id, 1);
    w.freeBuild = false;
    hall(w).stock.wood = 0;
    expect(buildCheck(w, 'p', 'lumberjack')).toMatchObject({ ok: true, free: true });
    const lj = place(w, 'lumberjack', 36, 31);
    staffBuilding(w, 'p', lj.id);
    run(w, 1500);
    // лісопилні не з'їдають резерв: на складі лишається дерево на нового лісоруба
    const min: number[] = [];
    for (let t = 0; t < 600; t++) { stepWorld(w); min.push(hall(w).stock.wood ?? 0); }
    expect(Math.min(...min.slice(100))).toBeGreaterThanOrEqual(10); // резерв під будівництво недоторканий
    expect(w.state.flows.total.byBuilding[lj.id].produced.wood).toBeGreaterThan(0);
    // другий лісоруб (5 дерева) будується: дерево над резервом є
    expect(buildCheck(w, 'p', 'lumberjack')).toMatchObject({ ok: true, free: false });
  });

  it('резерв: лісопилня не бере зі складу нижче порогу', () => {
    const w = setup();
    const sm = place(w, 'sawmill', 33, 31);
    hall(w).stock = { wood: 9 };
    staffBuilding(w, 'p', sm.id, 2);
    run(w, 300);
    expect(hall(w).stock.wood).toBe(9);
    expect(sm.stock.wood ?? 0).toBe(0);
  });

  it('пауза: лісопилня на паузі не працює і не приймає колоди', () => {
    const w = setup();
    const sm = place(w, 'sawmill', 33, 31);
    const lj = place(w, 'lumberjack', 36, 31);
    staffBuilding(w, 'p', lj.id, 2);
    staffBuilding(w, 'p', sm.id, 2);
    expect(applyCommand(w, { player: 'p', seq: 9, cmd: { type: 'set_building_paused', building: sm.id, paused: true } }).ok).toBe(true);
    run(w, 800);
    expect(w.state.flows.total.byBuilding[sm.id]?.produced.planks ?? 0).toBeLessThanOrEqual(1);
    expect(w.state.flows.total.edges[`${lj.id}>${sm.id}:wood`] ?? 0).toBe(0);
    applyCommand(w, { player: 'p', seq: 10, cmd: { type: 'set_building_paused', building: sm.id, paused: false } });
    run(w, 800);
    expect(w.state.flows.total.byBuilding[sm.id].produced.planks).toBeGreaterThan(0);
  });

  it('відстань не заважає: лісоруб працює з деревом за 40+ клітинок', () => {
    const w = setup();
    const rt = getSectorRt(w, 0);
    rt.kind.fill(0); rt.amount.fill(0); rt.forest.fill(0);
    const tree = 5 * SECTOR_SIZE + 60; // далеко від центру (≈ 40 клітинок від лісоруба)
    rt.kind[tree] = 1; rt.amount[tree] = 3; rt.forest[tree] = 1;
    const lj = place(w, 'lumberjack', 20, 36);
    expect(staffBuilding(w, 'p', lj.id)).toBeGreaterThan(0);
    run(w, 1500);
    expect(w.state.flows.total.byBuilding[lj.id]?.produced.wood ?? 0).toBeGreaterThan(0);
  });

  it('причина простою: немає вузлів -> no_node', () => {
    const w = setup();
    const rt = getSectorRt(w, 0);
    rt.kind.fill(0);
    const lj = place(w, 'lumberjack', 20, 36);
    staffBuilding(w, 'p', lj.id);
    run(w, 100);
    expect(w.why.get(lj.id)).toBe('no_node');
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
