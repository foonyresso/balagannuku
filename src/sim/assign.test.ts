import { describe, expect, it } from 'vitest';
import { MIGRATIONS, npcName, packPerk } from '../shared';
import { residents, applyCommand, getSectorRt, deserialize, serialize, staffBuilding, stepWorld } from './index';
import { setup, place, run } from './testkit';

describe('працівники: слоти, призначення, стати', () => {
  it('слоти й автопризначення: понад ліміт не призначається, вакансії заповнюються з вільних', () => {
    const w = setup(); // 5 вільних поселенців
    const lj = place(w, 'lumberjack', 40, 30);
    expect(staffBuilding(w, 'p', lj.id)).toBe(2); // слотів 2
    expect(applyCommand(w, { player: 'p', seq: 1, cmd: { type: 'assign_worker', npc: residents(w, 'p').find((r) => r.state === 'free')!.id, profession: 'lumberjack', building: lj.id } }).reason).toBe('occupied');
    run(w, 30);
    expect(lj.workers.length).toBe(2);
    expect(residents(w, 'p').filter((r) => r.state === 'free').length).toBe(3); // решта лишились вільними
    // зняли одного вручну: вакансію займає ІНШИЙ вільний, знятий вручну не повертається
    const gone = lj.workers[0];
    applyCommand(w, { player: 'p', seq: 2, cmd: { type: 'unassign_worker', npc: gone } });
    run(w, 30);
    expect(lj.workers.length).toBe(2);
    expect(lj.workers).not.toContain(gone);
    // лісопилня (2 слоти): два вільних іду до неї, а не в старий лісоруб (він повний)
    const sm = place(w, 'sawmill', 24, 24);
    run(w, 30);
    expect(sm.workers.length).toBe(2);
    expect(lj.workers.length).toBe(2);
    // дім: з'являються нові жителі, вільних вакансій немає — лишаються вільними, доки не збудують кар'єр
    place(w, 'house', 20, 20);
    run(w, 500);
    const freeNow = residents(w, 'p').filter((r) => r.state === 'free' && r.id !== gone).length;
    expect(freeNow).toBeGreaterThanOrEqual(1);
    const q = place(w, 'quarry', 30, 40);
    run(w, 30);
    expect(q.workers.length).toBeGreaterThanOrEqual(1);
    expect(q.workers.length).toBeLessThanOrEqual(4);
  });

  it('продуктивність масштабується з кількістю працівників (1 з 2 слотів ≈ 50%)', () => {
    const produced = (workers: number) => {
      const w = setup(21);
      w.npc.manual.fill(1);
      const lj = place(w, 'lumberjack', 40, 30);
      staffBuilding(w, 'p', lj.id, workers);
      run(w, 2500);
      return w.state.flows.total.byBuilding[lj.id]?.produced.wood ?? 0;
    };
    const one = produced(1), two = produced(2);
    expect(one).toBeGreaterThan(0);
    expect(two / one).toBeGreaterThan(1.5);
    expect(two / one).toBeLessThan(2.6);
  });

  it('жителі видимі: працівники розходяться по різних деревах, вільні не стовпляться; лічильник = список станів', () => {
    const w = setup();
    const tiles = (ids: number[]) => new Set(ids.map((i) => `${Math.floor(w.state.npcs.x[i])},${Math.floor(w.state.npcs.y[i])}`)).size;
    const all = residents(w, 'p');
    expect(all.length).toBe(w.state.npcs.count);
    expect(tiles(all.map((r) => r.id))).toBeGreaterThanOrEqual(4); // 5 вільних не в одній точці
    const lj = place(w, 'lumberjack', 40, 30);
    staffBuilding(w, 'p', lj.id);
    let spread = 0, samples = 0;
    for (let t = 0; t < 400; t++) {
      stepWorld(w);
      if (t > 100 && t % 10 === 0) { spread += tiles(lj.workers); samples++; }
    }
    expect(spread / samples).toBeGreaterThanOrEqual(1.7); // обидва працівники (слоти 2) на різних місцях
    const list = residents(w, 'p');
    expect(list.length).toBe(w.state.npcs.count);
    expect(list.filter((r) => r.state !== 'free').length).toBe(2); // слоти лісоруба = 2, решта вільні
    expect(list.some((r) => r.state === 'working' || r.state === 'to_node' || r.state === 'carrying')).toBe(true);
  });

  it('жителі: стани вільний/чекає з причиною', () => {
    const w = setup();
    expect(residents(w, 'p').every((r) => r.state === 'free')).toBe(true);
    getSectorRt(w, 0).kind.fill(0); // немає дерев
    const lj = place(w, 'lumberjack', 40, 30);
    staffBuilding(w, 'p', lj.id);
    run(w, 60);
    const r = residents(w, 'p')[0];
    expect(r.state).toBe('waiting');
    expect(r.why).toBe('no_node');
  });

  it('set_worker_count: мінус звільняє NPC, він іде на іншу роботу; плюс додає', () => {
    const w = setup();
    const lj = place(w, 'lumberjack', 36, 30), q = place(w, 'quarry', 30, 40);
    run(w, 30);
    const cnt = (b: { workers: number[] }) => b.workers.length;
    const set = (b: { id: number }, count: number) => applyCommand(w, { player: 'p', seq: 1, cmd: { type: 'set_worker_count', building: b.id, count } });
    expect(set(lj, 2).ok).toBe(true);
    expect(cnt(lj)).toBe(2);
    expect(set(lj, 1).ok).toBe(true);
    expect(cnt(lj)).toBe(1);
    run(w, 30);
    expect(cnt(lj)).toBe(1); // автопризначення не повертає зайвого
    expect(cnt(q)).toBeGreaterThan(0); // звільнений пішов в кар'єр
    expect(set(lj, 0).ok).toBe(true);
    expect(cnt(lj)).toBe(0);
    expect(set(lj, 99).ok).toBe(true);
    expect(lj.workerCap).toBe(2); // не вище максимуму будівлі
    expect(applyCommand(w, { player: 'x', seq: 2, cmd: { type: 'set_worker_count', building: lj.id, count: 1 } }).ok).toBe(false);
  });

  it('ручне призначення переносить NPC з іншої роботи, автопризначення його не ламає', () => {
    const w = setup();
    const lj = place(w, 'lumberjack', 36, 30), q = place(w, 'quarry', 30, 40);
    run(w, 30);
    const npc = lj.workers[0];
    const r = applyCommand(w, { player: 'p', seq: 1, cmd: { type: 'assign_worker', npc, profession: 'miner', building: q.id } });
    expect(r.ok).toBe(true);
    expect(lj.workers).not.toContain(npc);
    expect(q.workers).toContain(npc);
    run(w, 300);
    expect(q.workers).toContain(npc);
    // знятий вручну лишається вільним
    applyCommand(w, { player: 'p', seq: 2, cmd: { type: 'unassign_worker', npc } });
    run(w, 300);
    expect(w.npc.workplace[npc]).toBe(-1);
  });

  it('ім’я, стати й перки NPC зберігаються в сейві; старий сейв отримує норму', () => {
    const w = setup();
    const n = w.state.npcs;
    expect(n.stats[0]).toBe(100);
    expect(npcName(n.nameId[0]).length).toBeGreaterThan(3);
    n.stats[1] = 150; n.perkSlots[0] = packPerk(2, 77); n.gold[0] = 123; n.klass[0] = 2;
    const back = deserialize(serialize(w));
    expect(back.state.npcs.stats[1]).toBe(150);
    expect(back.state.npcs.perkSlots[0]).toBe(packPerk(2, 77));
    expect(back.state.npcs.gold[0]).toBe(123);
    expect(back.state.npcs.klass[0]).toBe(2);
    expect(back.state.npcs.nameId[0]).toBe(n.nameId[0]);
    const old = serialize(w) as unknown as { npcs: Record<string, unknown> };
    delete old.npcs.stats; delete old.npcs.nameId; delete old.npcs.perkSlots;
    const w2 = deserialize(old as never);
    expect(w2.state.npcs.stats[0]).toBe(100);
    expect(MIGRATIONS[4]({ version: 4 })).toEqual({ version: 5 });
  });

  it('стати: швидший ходок і більша ноша працюють швидше', () => {
    const run1 = (walk: number) => {
      const w = setup(5);
      const lj = place(w, 'lumberjack', 36, 30);
      staffBuilding(w, 'p', lj.id, 1);
      w.state.npcs.stats[lj.workers[0] * 4] = walk;
      run(w, 800);
      return w.state.flows.total.byBuilding[lj.id]?.produced.wood ?? 0;
    };
    expect(run1(200)).toBeGreaterThan(run1(100));
  });
});
