import { describe, expect, it } from 'vitest';
import { TASKS, MIGRATIONS } from '../../shared';
import { checkPlace, applyCommand, deserialize, serialize, staffBuilding, stepWorld } from '../index';
import { shoreNear } from '../world';
import { homeLake } from '../water';
import { setup, place, run, hall } from '../testkit';

describe('їжа і голод', () => {
  const woodAfter = (fullness: number, ticks: number, food = 0) => {
    const w = setup(5);
    const lj = place(w, 'lumberjack', 36, 30);
    hall(w).stock.food = food;
    staffBuilding(w, 'p', lj.id);
    w.state.npcs.fullness.fill(fullness);
    run(w, ticks);
    return { w, lj, wood: w.state.flows.total.byBuilding[lj.id]?.produced.wood ?? 0 };
  };

  it('ситість спадає з часом', () => {
    const w = setup();
    run(w, 600);
    expect(w.state.npcs.fullness[0]).toBeLessThan(100);
    expect(w.state.npcs.fullness[0]).toBeGreaterThan(40);
  });

  it('голодний NPC їсть зі складу: їжа зменшується, ситість росте, потік склад -> люди', () => {
    const w = setup(5);
    const lj = place(w, 'lumberjack', 36, 30);
    staffBuilding(w, 'p', lj.id);
    const id = lj.workers[0];
    w.state.npcs.fullness[id] = 40;
    const food0 = hall(w).stock.food ?? 0;
    run(w, 400);
    expect(w.state.npcs.fullness[id]).toBeGreaterThan(50);
    expect(hall(w).stock.food ?? 0).toBeLessThan(food0);
    expect(w.state.flows.total.edges[`${hall(w).id}>-1:food`] ?? 0).toBeGreaterThan(0);
  });

  it('без їжі й на нулі ситості NPC не працює', () => {
    expect(woodAfter(100, 600).wood).toBeGreaterThan(0);
    expect(woodAfter(0, 600).wood).toBe(0);
  });

  it('голодний (нижче порога) працює повільніше за ситого', () => {
    expect(woodAfter(29, 300).wood).toBeLessThan(woodAfter(100, 300).wood);
  });

  it('ферма виробляє їжу й несе до складу', () => {
    const w = setup(5);
    const farm = place(w, 'farm', 36, 30);
    hall(w).stock.food = 0;
    staffBuilding(w, 'p', farm.id);
    expect(farm.workers.length).toBeGreaterThan(0);
    run(w, 1500);
    expect(w.state.flows.total.byBuilding[farm.id]?.produced.food ?? 0).toBeGreaterThan(3);
    expect(w.state.flows.total.edges[`${farm.id}>${hall(w).id}:food`] ?? 0).toBeGreaterThan(0);
    expect(hall(w).stock.food ?? 0).toBeGreaterThan(0);
  });

  it('ферма 20×20: фермери працюють на полі всередині footprint, не збоку', () => {
    const w = setup(5);
    const farm = place(w, 'farm', 36, 30);
    expect(farm.size).toEqual({ w: 20, h: 20 });
    staffBuilding(w, 'p', farm.id);
    const n = w.state.npcs, on = new Set<number>();
    let working = 0, inside = 0;
    for (let t = 0; t < 1500; t++) {
      stepWorld(w);
      for (const i of farm.workers) {
        if (n.task[i] !== TASKS.indexOf('work')) continue;
        working++;
        const x = Math.floor(n.x[i]), y = Math.floor(n.y[i]);
        if (x >= farm.cell.x && x < farm.cell.x + 20 && y >= farm.cell.y && y < farm.cell.y + 20) { inside++; on.add(y * 1000 + x); }
      }
    }
    expect(working).toBeGreaterThan(0);
    expect(inside / working).toBeGreaterThan(0.9);
    expect(on.size).toBeGreaterThan(1);
    expect(checkPlace(w, 0, 'house', farm.cell.x + 10, farm.cell.y + 10)).toBe('occupied'); // поле не віддають під забудову
  });

  it('фермер не потрапляє в глухий кут: на нулі ситості без їжі теж працює', () => {
    const w = setup(5);
    const farm = place(w, 'farm', 36, 30);
    hall(w).stock.food = 0;
    staffBuilding(w, 'p', farm.id);
    w.state.npcs.fullness.fill(0);
    run(w, 1500);
    expect(hall(w).stock.food ?? 0).toBeGreaterThan(0);
  });

  it('старий сейв без ситості завантажується з повною ситістю; міграція 8->9', () => {
    const w = setup();
    const old = serialize(w) as unknown as { npcs: Record<string, unknown> };
    delete old.npcs.fullness;
    expect(deserialize(old as never).state.npcs.fullness[0]).toBe(100);
    w.state.npcs.fullness[0] = 33;
    expect(deserialize(serialize(w)).state.npcs.fullness[0]).toBe(33);
    expect(MIGRATIONS[8]({ version: 8 })).toEqual({ version: 9 });
  });
});

describe('риболовля', () => {
  it('рибалку можна ставити лише біля води; рибалка ловить їжу й несе до складу', () => {
    const w = setup(5);
    const hl = homeLake(5), wx = Math.round(hl.x), wy = Math.round(hl.y);
    expect(checkPlace(w, 0, 'fisher', hall(w).cell.x + 40, hall(w).cell.y)).toBe('invalid'); // далеко від води
    const sh = shoreNear(w, 0, wx, wy, 300)!;
    let at: { x: number; y: number } | null = null;
    for (let d = 0; d < 32 && !at; d++) for (let dy = -d; dy <= d && !at; dy++) for (let dx = -d; dx <= d && !at; dx++) {
      const x = sh.x + dx, y = sh.y + dy;
      if (checkPlace(w, 0, 'fisher', x, y) === null) at = { x, y };
    }
    expect(at).not.toBeNull();
    w.freeBuild = true;
    const r = applyCommand(w, { player: 'p', seq: 1, cmd: { type: 'place_building', kind: 'fisher', sector: 0, cell: at! } });
    expect(r.ok).toBe(true);
    const b = w.state.buildings[w.state.buildings.length - 1];
    hall(w).stock.food = 0;
    staffBuilding(w, 'p', b.id, 1);
    expect(b.workers.length).toBe(1);
    run(w, 3500);
    const f = w.state.flows.total;
    expect(f.byBuilding[b.id]?.produced.food ?? 0).toBeGreaterThan(0);
    expect(f.edges[`${b.id}>${hall(w).id}:food`] ?? 0).toBeGreaterThan(0);
  });
});
