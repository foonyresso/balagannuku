import { describe, expect, it } from 'vitest';
import { SECTOR_CELLS, SECTOR_SIZE, MIGRATIONS } from '../shared';
import { buildCheck, checkPlace, applyCommand, getSectorRt, deserialize, serialize, staffBuilding, stepWorld } from './index';
import { FOOTPRINT } from './balance';
import { setup, BORDER_OCC, free, place, run, hall } from './testkit';

describe('економіка', () => {
  it('ланцюжок: лісоруб -> склад -> лісопильня -> дошки', () => {
    const w = setup(1);
    const lj = place(w, 'lumberjack', 36, 30);
    const sm = place(w, 'sawmill', 28, 30);
    staffBuilding(w, 'p', lj.id);
    staffBuilding(w, 'p', sm.id);
    expect(lj.workers.length + sm.workers.length).toBe(4); // слоти: лісоруб 2 + лісопилня 2
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

  it('footprint: будівлі різного розміру в тайлах, перекриття заборонене, вхід по центру низу', () => {
    const w = setup();
    const t = hall(w);
    expect(t.size).toEqual(FOOTPRINT.townhall);
    expect(t.entrance).toEqual({ x: t.cell.x + t.size.w / 2, y: t.cell.y + t.size.h });
    const wh = place(w, 'warehouse', 20, 20);
    expect(wh.size).toEqual(FOOTPRINT.warehouse);
    // перекриття footprint (навіть на 1 тайл) — відмова; поруч упритул — можна
    expect(checkPlace(w, 0, 'house', wh.cell.x + wh.size.w - 1, wh.cell.y)).toBe('occupied');
    expect(checkPlace(w, 0, 'house', -1, 5)).toBe('invalid');
    const rt = getSectorRt(w, 0);
    expect(rt.occ.reduce((a, v) => a + v, 0) - BORDER_OCC - rt.water.reduce((a, v) => a + v, 0)).toBe(t.size.w * t.size.h + wh.size.w * wh.size.h);
    applyCommand(w, { player: 'p', seq: 3, cmd: { type: 'demolish_building', building: wh.id } });
    expect(rt.occ.reduce((a, v) => a + v, 0) - BORDER_OCC - rt.water.reduce((a, v) => a + v, 0)).toBe(t.size.w * t.size.h);
  });

  it('міграція v2 -> v3: порожній світ переноситься, місто відхиляється з повідомленням', () => {
    const base = { version: 2, state: { buildings: [], npcs: { count: 0 }, sectors: [{ id: 0, trails: { type: 'u16', length: 4096, base64: '' } }] } };
    const ok = MIGRATIONS[2](base) as { version: number; state: { sectors: { trails: unknown }[] } };
    expect(ok.version).toBe(3);
    expect(ok.state.sectors[0].trails).toBeNull();
    expect(() => MIGRATIONS[2]({ ...base, state: { ...base.state, buildings: [{}] } })).toThrow(/нову гру/);
  });

  it('команди: відмови без ресурсів, зайнята клітинка, чужі', () => {
    const w = setup();
    place(w, 'warehouse', 20, 20);
    const occ = applyCommand(w, { player: 'p', seq: 2, cmd: { type: 'place_building', kind: 'warehouse', sector: 0, cell: { x: w.state.buildings[1].cell.x, y: w.state.buildings[1].cell.y } } });
    expect(occ.reason).toBe('occupied');
    w.state.buildings.forEach((b) => (b.stock = {}));
    const poor = applyCommand(w, { player: 'p', seq: 3, cmd: { type: 'place_building', kind: 'warehouse', sector: 0, cell: free(w, 'warehouse', 40, 40) } });
    expect(poor.reason).toBe('no_resources');
    const alien = applyCommand(w, { player: 'x', seq: 4, cmd: { type: 'place_building', kind: 'warehouse', sector: 0, cell: free(w, 'warehouse', 40, 40) } });
    expect(alien.reason).toBe('not_owner');
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
    expect(SECTOR_SIZE).toBe(SECTOR_CELLS * 4);
  });
});
