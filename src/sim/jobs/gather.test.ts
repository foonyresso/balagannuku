import { describe, expect, it } from 'vitest';
import { SECTOR_CELLS } from '../../shared';
import { residents, getSectorRt, staffBuilding, stepWorld } from '../index';
import { setup, OFF, place, run, hall } from '../testkit';

describe('добувачі', () => {
  it('відстань не заважає: лісоруб працює з деревом за 40+ клітинок', () => {
    const w = setup();
    const rt = getSectorRt(w, 0);
    rt.kind.fill(0); rt.amount.fill(0); rt.forest.fill(0);
    const tree = (5 + OFF) * SECTOR_CELLS + 60 + OFF; // далеко від центру (≈ 40 клітинок від лісоруба)
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

  it('цикл лісоруба: 3 колоди по одній -> хатинка -> обтесування -> лише потім доставка', () => {
    const w = setup();
    w.npc.manual.fill(1); // лише один працівник: решта вільних не автопризначається
    const lj = place(w, 'lumberjack', 40, 30);
    staffBuilding(w, 'p', lj.id, 1);
    const id = lj.workers[0];
    const seq: string[] = [];
    const carries = new Set<number>();
    let woodOnlyFromDelivery = true, prevState = '', prevWood = hall(w).stock.wood ?? 0;
    for (let t = 0; t < 900; t++) {
      stepWorld(w);
      const r = residents(w, 'p').find((x) => x.id === id)!;
      if (r.state !== 'planning' && seq[seq.length - 1] !== r.state) seq.push(r.state);
      carries.add(r.carry);
      const wood = hall(w).stock.wood ?? 0;
      // склад поповнюється лише в момент доставки обтесаного (попередній стан — «несе готове»)
      if (wood > prevWood && prevState !== 'carrying') woodOnlyFromDelivery = false;
      prevWood = wood; prevState = r.state;
    }
    const first = seq.slice(0, 12).join('>');
    expect(first).toContain('to_node>working>to_node>working>to_node>working>to_home>processing>carrying');
    expect([...carries]).toEqual(expect.arrayContaining([0, 1, 2, 3]));
    expect(woodOnlyFromDelivery).toBe(true);
    const f = w.state.flows.total;
    expect(f.byBuilding[lj.id].produced.wood! % 3).toBe(0); // виробництво — партіями по 3 після обтесування
    expect(f.edges[`0>${lj.id}:wood`]).toBeGreaterThanOrEqual(f.byBuilding[lj.id].produced.wood!);
    expect(f.edges[`${lj.id}>${hall(w).id}:wood`]).toBeGreaterThan(0);
  });
});

describe('полювання', () => {
  it('мисливець добуває їжу в лісі й несе до складу', () => {
    const w = setup(5);
    const b = place(w, 'hunter', 36, 30);
    hall(w).stock.food = 0;
    staffBuilding(w, 'p', b.id);
    expect(b.workers.length).toBeGreaterThan(0);
    run(w, 1200);
    const f = w.state.flows.total;
    expect(f.byBuilding[b.id]?.produced.food ?? 0).toBeGreaterThan(0);
    expect(f.edges[`${b.id}>${hall(w).id}:food`] ?? 0).toBeGreaterThan(0);
    expect(f.edges[`0>${b.id}:food`] ?? 0).toBeGreaterThan(0);
  });
});
