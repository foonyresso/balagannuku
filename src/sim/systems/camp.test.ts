import { describe, expect, it } from 'vitest';
import { CAMP_MIN_SLOTS, CAMP_PLAZA, CAMP_RING } from '../../shared';
import { applyCommand, campfireFor, checkPlace } from '../index';
import { spawnNpc } from '../npcs';
import { hall, place, run, setup } from '../testkit';

describe('вогнище вільних жителів', () => {
  const w = setup(), h = hall(w), fire = campfireFor(w, 'p', 0)!;
  w.npc.manual.fill(1); // вільних не розбирає автопризначення
  const near = (i: number): boolean => Math.hypot(w.state.npcs.x[i] - fire.x, w.state.npcs.y[i] - fire.y) <= CAMP_RING + 1.5;
  const atFire = (): number[] => [...Array(w.state.npcs.capacity).keys()].filter((i) => w.state.npcs.alive[i] && w.npc.workplace[i] < 0 && near(i));

  it('стоїть перед ратушею на відстані ≈ її розміру, на площі нічого не будують', () => {
    expect(fire.y - h.entrance.y).toBeGreaterThanOrEqual(h.size.h - 4);
    expect(fire.y - h.entrance.y).toBeLessThanOrEqual(h.size.h + 12);
    expect(checkPlace(w, 0, 'house', fire.x, fire.y)).toBe('occupied');
    expect(checkPlace(w, 0, 'house', fire.x + CAMP_PLAZA - 1, fire.y)).toBe('occupied');
  });

  it('усі вільні сходяться до вогнища й чекають', () => {
    run(w, 800);
    expect(atFire().length).toBe(5);
  });

  it('вільних більше за слоти: біля вогнища щонайменше 5, решта бродить містом', () => {
    for (let k = 0; k < 4; k++) spawnNpc(w, 0, 0, h.entrance.x, h.entrance.y);
    w.npc.manual.fill(1);
    run(w, 1200);
    expect(atFire().length).toBeGreaterThanOrEqual(CAMP_MIN_SLOTS);
    const slots = [...w.npc.camp].filter((s, i) => w.state.npcs.alive[i] && s >= 0);
    expect(new Set(slots).size).toBe(CAMP_MIN_SLOTS);
  });

  it('когось забрали на роботу — слот займає інший вільний', () => {
    const lj = place(w, 'lumberjack', 40, 30);
    const taken = atFire()[0];
    expect(applyCommand(w, { player: 'p', seq: 1, cmd: { type: 'assign_worker', npc: taken, profession: 'lumberjack', building: lj.id } }).ok).toBe(true);
    expect(w.npc.camp[taken]).toBe(-1);
    run(w, 1200);
    expect(atFire().filter((i) => w.npc.workplace[i] < 0).length).toBeGreaterThanOrEqual(CAMP_MIN_SLOTS);
    expect([...w.npc.camp].filter((s, i) => w.state.npcs.alive[i] && s >= 0 && w.npc.workplace[i] < 0).length).toBe(CAMP_MIN_SLOTS);
  });

  it('детермінізм: той самий світ дає ті самі позиції', () => {
    const a = setup(5), b = setup(5);
    run(a, 300); run(b, 300);
    expect([...a.state.npcs.x]).toEqual([...b.state.npcs.x]);
    expect(campfireFor(a, 'p', 0)).toEqual(campfireFor(b, 'p', 0));
  });
});
