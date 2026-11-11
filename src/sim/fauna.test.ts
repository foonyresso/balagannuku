import { describe, expect, it } from 'vitest';
import type { PlayerState } from '../shared';
import { ANIMALS, ANIMAL_KINDS, ANIMAL_MODE, MIGRATIONS, RESOURCE_KINDS } from '../shared';
import { applyCommand, createWorld, deserialize, serialize, startCity, staffBuilding, stepWorld, checkPlace, type SimWorld } from './index';
import { claimStart } from './worldgen';
import { COMPACT_NODEGEN, configureNodegen } from './nodegen';
import { faunaCounts, findPrey, killAnimal, SHOOT_RANGE } from './fauna';

const mk = (id: string): PlayerState => ({
  id, nickname: id, token: id, color: 1, homeSector: null, ownedSectors: [],
  resources: Object.fromEntries(RESOURCE_KINDS.map((k) => [k, 0])) as PlayerState['resources'],
});
function setup(seed = 5): SimWorld {
  configureNodegen(COMPACT_NODEGEN);
  const w = createWorld(seed, [mk('p')]);
  expect(claimStart(w.state, 'p', 0).ok).toBe(true);
  startCity(w, 'p');
  return w;
}
const run = (w: SimWorld, t: number) => { for (let i = 0; i < t; i++) stepWorld(w); };
const hall = (w: SimWorld) => w.state.buildings[0];
function placeHunter(w: SimWorld) {
  let at: { x: number; y: number } | null = null, bd = Infinity;
  const h = hall(w);
  for (let y = h.cell.y - 60; y < h.cell.y + 60; y += 2) for (let x = h.cell.x - 60; x < h.cell.x + 60; x += 2) {
    const d = Math.abs(x - h.cell.x) + Math.abs(y - h.cell.y);
    if (d < bd && checkPlace(w, 0, 'hunter', x, y) === null) { bd = d; at = { x, y }; }
  }
  const r = applyCommand(w, { player: 'p', seq: 1, cmd: { type: 'place_building', kind: 'hunter', sector: 0, cell: at! } });
  expect(r.ok, String(r.reason)).toBe(true);
  return w.state.buildings[w.state.buildings.length - 1];
}

describe('фауна', () => {
  it('звірі всіх видів з’являються навколо міста, не в будівлях і не в воді', () => {
    const w = setup();
    run(w, 2);
    const c = faunaCounts(w);
    for (const k of ANIMAL_KINDS) expect(c[k], k).toBeGreaterThan(0);
    const rt = w.sectors.get(0)!;
    for (const a of w.state.fauna.animals) expect(rt.occ[Math.floor(a.y) * 3312 + Math.floor(a.x)]).toBe(0);
  });

  it('звірі блукають, не потрапляють у будівлі й не лізуть до ратуші', () => {
    const w = setup();
    run(w, 2);
    const start = w.state.fauna.animals.map((a) => ({ x: a.x, y: a.y }));
    run(w, 400);
    const rt = w.sectors.get(0)!, h = hall(w);
    const moved = w.state.fauna.animals.filter((a, i) => start[i] && Math.hypot(a.x - start[i].x, a.y - start[i].y) > 3).length;
    expect(moved).toBeGreaterThan(5);
    for (const a of w.state.fauna.animals) {
      expect(rt.occ[Math.floor(a.y) * 3312 + Math.floor(a.x)]).toBe(0);
      expect(Math.hypot(a.x - h.entrance.x, a.y - h.entrance.y)).toBeGreaterThan(25);
    }
  });

  it('популяція відновлюється після загибелі звірів', () => {
    const w = setup();
    run(w, 2);
    const before = faunaCounts(w).rabbit;
    for (const a of w.state.fauna.animals) if (a.kind === 'rabbit') killAnimal(a);
    expect(faunaCounts(w).rabbit).toBe(0);
    run(w, 40 * 20);
    expect(faunaCounts(w).rabbit).toBeGreaterThanOrEqual(Math.min(before, 3));
    expect(w.state.fauna.animals.some((a) => a.mode === ANIMAL_MODE.dead)).toBe(false); // тушки зникли
  });

  it('вовки й ведмеді небезпечні: не дичина, не тікають', () => {
    expect(ANIMALS.wolf.aggressive && ANIMALS.bear.aggressive).toBe(true);
    expect(ANIMALS.wolf.huntable || ANIMALS.bear.huntable).toBe(false);
    const w = setup();
    run(w, 2);
    const p = findPrey(w, 0, hall(w).entrance.x, hall(w).entrance.y, 0);
    expect(p === null || ANIMALS[p.kind].huntable).toBe(true);
  });

  it('мисливець справді полює: стріляє, добуває звіра й несе мʼясо до складу', () => {
    const w = setup();
    const b = placeHunter(w);
    hall(w).stock.food = 0;
    staffBuilding(w, 'p', b.id);
    expect(b.workers.length).toBeGreaterThan(0);
    const woodBefore = w.state.flows.total.byBuilding[b.id]?.produced.wood ?? 0;
    let killed = 0, last = w.state.fauna.animals.length;
    for (let t = 0; t < 4000; t++) {
      stepWorld(w);
      const dead = w.state.fauna.animals.filter((a) => a.mode === ANIMAL_MODE.dead).length;
      if (dead) killed++;
      last = w.state.fauna.animals.length;
    }
    const f = w.state.flows.total;
    expect(killed).toBeGreaterThan(0);
    expect(f.byBuilding[b.id]?.produced.food ?? 0).toBeGreaterThan(2);
    expect(f.edges[`${b.id}>${hall(w).id}:food`] ?? 0).toBeGreaterThan(0);
    expect(f.byBuilding[b.id]?.produced.wood ?? 0).toBe(woodBefore); // не рубає дерево
    expect(last).toBeGreaterThan(10); // звірі не зникли всі
  });

  it('мисливець стріляє з відстані, а не підходить упритул', () => {
    const w = setup();
    const b = placeHunter(w);
    staffBuilding(w, 'p', b.id);
    const hn = b.workers[0], n = w.state.npcs;
    let startD = 0, shots = 0;
    for (let t = 0; t < 4000 && shots < 3; t++) {
      stepWorld(w);
      if (w.npc.phase[hn] === 16) { // HUNT_AIM
        const a = w.state.fauna.animals.find((x) => x.id === w.npc.aux[hn]);
        if (a && w.npc.timer[hn] === 8) startD = Math.max(startD, Math.hypot(a.x - n.x[hn], a.y - n.y[hn]));
        if (a && w.npc.timer[hn] === 1) shots++;
      }
    }
    expect(shots).toBeGreaterThan(0);
    expect(startD).toBeGreaterThan(3); // не впритул
    expect(startD).toBeLessThanOrEqual(SHOOT_RANGE + 1.5);
  });

  it('детермінізм і сейв: фауна зберігається й відтворюється', () => {
    const a = setup(9), b = setup(9);
    run(a, 300); run(b, 300);
    expect(JSON.stringify(a.state.fauna)).toBe(JSON.stringify(b.state.fauna));
    const c = deserialize(serialize(a));
    expect(c.state.fauna.animals.length).toBe(a.state.fauna.animals.length);
    expect(MIGRATIONS[9]({ version: 9 })).toEqual({ version: 10 });
    const old = serialize(a) as unknown as { fauna?: unknown };
    delete old.fauna;
    expect(deserialize(old as never).state.fauna.animals).toEqual([]);
  });
});
