import { describe, expect, it } from 'vitest';
import type { PlayerState } from '../shared';
import { RESOURCE_KINDS, SECTOR_CELLS, SECTOR_SIZE } from '../shared';
import { applyCommand, checkPlace, createWorld, getSectorRt, startCity, staffBuilding, stepWorld, type SimWorld } from './index';
import { TREE_AMOUNT, TREE_GROWTH, TREE_STAGE_TICKS } from './balance';
import { claimStart } from './worldgen';
import { COMPACT_NODEGEN, configureNodegen } from './nodegen';
import { growTrees } from './step';

const mk = (id: string): PlayerState => ({
  id, nickname: id, token: id, color: 1, homeSector: null, ownedSectors: [],
  resources: Object.fromEntries(RESOURCE_KINDS.map((k) => [k, 0])) as PlayerState['resources'],
});
const setup = (): SimWorld => {
  configureNodegen(COMPACT_NODEGEN);
  const w = createWorld(7, [mk('p')]);
  expect(claimStart(w.state, 'p', 0).ok).toBe(true);
  startCity(w, 'p');
  return w;
};
const run = (w: SimWorld, t: number) => { for (let i = 0; i < t; i++) stepWorld(w); };
const place = (w: SimWorld, x0: number, y0: number) => {
  let best = { x: x0, y: y0 }, bd = Infinity;
  for (let y = 0; y < SECTOR_SIZE; y += 2) for (let x = 0; x < SECTOR_SIZE; x += 2) {
    const d = Math.abs(x - x0) + Math.abs(y - y0);
    if (d < bd && checkPlace(w, 0, 'lumberjack', x, y) === null) { bd = d; best = { x, y }; }
  }
  expect(applyCommand(w, { player: 'p', seq: 1, cmd: { type: 'place_building', kind: 'lumberjack', sector: 0, cell: best } }).ok).toBe(true);
  return w.state.buildings[w.state.buildings.length - 1];
};
const OFF = SECTOR_CELLS / 2 - 32;

describe('дерева: рубка й ріст', () => {
  it('ріст стадіями: пеньок -> саджанець -> молоде -> доросле, ~TREE_STAGE_TICKS на стадію', () => {
    const w = setup();
    const rt = getSectorRt(w, 0);
    rt.kind.fill(0); rt.amount.fill(0); rt.forest.fill(0);
    const c = (5 + OFF) * SECTOR_CELLS + 60 + OFF;
    rt.kind[c] = 1; rt.amount[c] = 0;
    const seen: number[] = [0];
    for (let t = 0; t < TREE_STAGE_TICKS * 4 + 20; t++) {
      stepWorld(w);
      if (rt.amount[c] !== seen[seen.length - 1]) seen.push(rt.amount[c]);
    }
    expect(seen).toEqual([0, 1, 2, TREE_AMOUNT]);
    expect(rt.forest[c]).toBe(1);
    const before = rt.amount[c];
    run(w, 400);
    expect(rt.amount[c]).toBe(before); // доросле не росте далі
  });

  it('множник росту пришвидшує дерева', () => {
    const grow = (mult: number): number => {
      TREE_GROWTH.mult = mult;
      try {
        const w = setup(), rt = getSectorRt(w, 0);
        rt.kind.fill(0); rt.amount.fill(0);
        const c = (5 + OFF) * SECTOR_CELLS + 60 + OFF;
        rt.kind[c] = 1;
        let t = 0;
        while (rt.amount[c] < TREE_AMOUNT && t < 5000) { stepWorld(w); t++; }
        return t;
      } finally { TREE_GROWTH.mult = 1; }
    };
    const slow = grow(1), fast = grow(4);
    expect(fast).toBeLessThan(slow / 2);
  });

  it('growTrees не чіпає каміння й не росте понад доросле', () => {
    const w = setup(), rt = getSectorRt(w, 0);
    rt.kind.fill(0); rt.amount.fill(0);
    rt.kind[10] = 2; rt.amount[10] = 0; rt.kind[11] = 1; rt.amount[11] = TREE_AMOUNT;
    for (let t = 0; t < 600; t++) { w.state.tick = t; growTrees(w); }
    expect(rt.amount[10]).toBe(0);
    expect(rt.amount[11]).toBe(TREE_AMOUNT);
  });

  it('лісоруб рубає лише доросле, за рейс 3 дерева, лишає пеньки й подає події падіння', () => {
    const w = setup();
    w.npc.manual.fill(1);
    const rt = getSectorRt(w, 0);
    rt.kind.fill(0); rt.amount.fill(0); rt.forest.fill(0);
    const base = (10 + OFF) * SECTOR_CELLS + 20 + OFF;
    const mature = [base, base + 3, base + 6, base + 9], young = base + 12;
    for (const c of mature) { rt.kind[c] = 1; rt.amount[c] = TREE_AMOUNT; rt.forest[c] = 1; }
    rt.kind[young] = 1; rt.amount[young] = 2; // молоде лісоруб не чіпає
    TREE_GROWTH.mult = 0.01; // без росту під час перевірки
    try {
      const lj = place(w, (14 + OFF) * 4, (14 + OFF) * 4);
      staffBuilding(w, 'p', lj.id, 1);
      const id = lj.workers[0];
      const felled: number[] = [];
      let maxCarry = 0, carryAtFirstHome = -1;
      for (let t = 0; t < 400; t++) {
        stepWorld(w);
        for (const e of w.events) if (e.e === 'tree_felled') felled.push(e.cell);
        maxCarry = Math.max(maxCarry, w.state.npcs.carryAmount[id]);
        if (carryAtFirstHome < 0 && w.npc.phase[id] === 8) carryAtFirstHome = w.state.npcs.carryAmount[id]; // WALK_HOME
        if (felled.length >= 3 && w.npc.phase[id] === 8) break;
      }
      expect(carryAtFirstHome).toBe(3); // у хатинку несе саме 3 колоди
      expect(maxCarry).toBe(3);
      expect(new Set(felled).size).toBe(felled.length);
      expect(felled.every((c) => mature.includes(c))).toBe(true);
      expect(felled.length).toBe(3);
      for (const c of felled) { expect(rt.amount[c]).toBe(0); expect(rt.kind[c]).toBe(1); expect(rt.forest[c]).toBe(0); } // пеньки
      expect(rt.amount[young]).toBe(2);
    } finally { TREE_GROWTH.mult = 1; }
  });

  it('безкінечний ресурс: ліс відростає й лісоруб працює довго', () => {
    const w = setup();
    const lj = place(w, (36 + OFF) * 4, (30 + OFF) * 4);
    staffBuilding(w, 'p', lj.id);
    run(w, 3000);
    const rt = getSectorRt(w, 0);
    let stumps = 0, grown = 0;
    for (let i = 0; i < rt.kind.length; i++) if (rt.kind[i] === 1) { if (rt.amount[i] === 0) stumps++; else if (rt.amount[i] >= TREE_AMOUNT) grown++; }
    expect(grown).toBeGreaterThan(0);
    expect(w.state.flows.total.byBuilding[lj.id]?.produced.wood ?? 0).toBeGreaterThan(20);
    expect(stumps).toBeLessThan(grown); // зрубане встигає відростати
  });
});
