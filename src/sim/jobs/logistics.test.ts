import { describe, expect, it } from 'vitest';
import { checkPlace, applyCommand, staffBuilding, stepWorld } from '../index';
import { setup, place, run, hall, idleOf } from '../testkit';

describe('логістика: куди несуть і звідки беруть', () => {
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
    w.npc.manual.fill(1); // вільні лишаються вільними (без автопризначення на лісопилку)
    staffBuilding(w, 'p', lj.id, 2);
    run(w, 400);
    const e = w.state.flows.total.edges;
    expect(e[`${lj.id}>${sm.id}:wood`] ?? 0).toBe(0);
    expect(e[`${lj.id}>${hall(w).id}:wood`] ?? 0).toBeGreaterThan(0);
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

  it('пауза перемикається одразу й незалежно від працівників', () => {
    const w = setup();
    const sm = place(w, 'sawmill', 33, 31); // без працівників
    for (let k = 0; k < 6; k++) {
      const want = k % 2 === 0;
      expect(applyCommand(w, { player: 'p', seq: k, cmd: { type: 'set_building_paused', building: sm.id, paused: want } }).ok).toBe(true);
      expect(sm.paused).toBe(want);
      run(w, 7);
    }
  });

  it('ратуша безкінечна: приймає більше за старий ліміт', () => {
    const w = setup();
    const lj = place(w, 'lumberjack', 36, 30);
    hall(w).stock.wood = 5000;
    staffBuilding(w, 'p', lj.id);
    run(w, 600);
    expect(hall(w).stock.wood!).toBeGreaterThan(5000);
  });

  it('підсклад: лісоруб несе до ближчого складу, а носій переносить у ратушу', () => {
    const w = setup(5);
    const lj = place(w, 'lumberjack', 36, 30);
    const hx = hall(w).entrance.x, hy = hall(w).entrance.y;
    let at = { x: 0, y: 0 }, bd = Infinity; // тайл біля лісоруба, найближчий до нього й ближчий за ратушу
    for (let y = lj.cell.y - 30; y < lj.cell.y + 30; y += 2) for (let x = lj.cell.x - 30; x < lj.cell.x + 30; x += 2) {
      if (checkPlace(w, 0, 'warehouse', x, y) !== null) continue;
      const d = Math.abs(x + 6 - lj.entrance.x) + Math.abs(y + 12 - lj.entrance.y);
      if (d < bd && d >= 12 && d < Math.abs(lj.entrance.x - hx) + Math.abs(lj.entrance.y - hy) - 6) { bd = d; at = { x, y }; }
    }
    expect(bd).toBeLessThan(Infinity);
    expect(applyCommand(w, { player: 'p', seq: 1, cmd: { type: 'place_building', kind: 'warehouse', sector: 0, cell: at } }).ok).toBe(true);
    const wh = w.state.buildings[w.state.buildings.length - 1];
    const d = (a: typeof lj, b: typeof lj) => Math.abs(a.entrance.x - b.entrance.x) + Math.abs(a.entrance.y - b.entrance.y);
    expect(d(lj, wh)).toBeLessThan(d(lj, hall(w))); // склад ближчий за ратушу
    staffBuilding(w, 'p', lj.id);
    expect(wh.workers.length).toBe(0); // підсклад без працівників, поки гравець не додасть
    expect(applyCommand(w, { player: 'p', seq: 1, cmd: { type: 'set_worker_count', building: wh.id, count: 1 } }).ok).toBe(true);
    run(w, 1500);
    const e = w.state.flows.total.edges;
    expect(wh.workers.length).toBe(1);
    expect(w.npc.workplace[wh.workers[0]]).toBe(wh.id);
    expect(e[`${lj.id}>${wh.id}:wood`] ?? 0).toBeGreaterThan(0); // видобувач -> підсклад
    expect(e[`${wh.id}>${hall(w).id}:wood`] ?? 0).toBeGreaterThan(0); // носій -> ратуша
  });

  it('носій бере більше за звичайну ношу', () => {
    const w = setup();
    const wh = place(w, 'warehouse', 38, 32);
    wh.stock.wood = 100;
    const id = idleOf(w);
    applyCommand(w, { player: 'p', seq: 1, cmd: { type: 'assign_worker', npc: id, profession: 'carrier', building: wh.id } });
    let maxCarry = 0;
    for (let t = 0; t < 400; t++) { stepWorld(w); maxCarry = Math.max(maxCarry, w.state.npcs.carryAmount[id]); }
    expect(maxCarry).toBeGreaterThan(3);
    expect(wh.stock.wood!).toBeLessThan(100);
  });
});
