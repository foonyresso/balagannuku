import { describe, expect, it } from 'vitest';
import type { PlayerState } from '../shared';
import { ACTIVE_MAX_TILE, ACTIVE_MIN_TILE, DEFAULT_TRAIL_THRESHOLDS, RESOURCE_KINDS, SECTOR_CELLS, SECTOR_SIZE, TrailStage } from '../shared';
import { decayTrails, stepOn, residents, buildCheck, checkPlace, applyCommand, createWorld, getSectorRt, deserialize, serialize, startCity, staffBuilding, stepWorld, type SimWorld } from './index';
import { findPath, setRoadPull } from './path';
import { ROAD_SPEED_MULT } from '../shared';
import { MIGRATIONS, npcName } from '../shared';
import { FOOTPRINT } from './balance';
import { claimStart } from './worldgen';
import { markFootprint } from './world';
import { planRoute } from './route';
import { COMPACT_NODEGEN, configureNodegen } from './nodegen';

const mk = (id: string): PlayerState => ({
  id, nickname: id, token: id, color: 1, homeSector: null, ownedSectors: [],
  resources: Object.fromEntries(RESOURCE_KINDS.map((k) => [k, 0])) as PlayerState['resources'],
});

export function setup(seed = 7): SimWorld {
  configureNodegen(COMPACT_NODEGEN); // тести економіки йдуть у компактному світі (ресурси поруч з ратушею)
  const w = createWorld(seed, [mk('p')]);
  expect(claimStart(w.state, 'p', 0).ok).toBe(true);
  startCity(w, 'p');
  return w;
}
/** Координати тестів задані відносно центру колишнього 64-клітинкового сектора. */
/** Тайли неактивної смуги завжди зайняті. */
const BORDER_OCC = SECTOR_SIZE * SECTOR_SIZE - (ACTIVE_MAX_TILE - ACTIVE_MIN_TILE) ** 2;
const OFF = SECTOR_CELLS / 2 - 32;
type Kind = 'lumberjack' | 'quarry' | 'sawmill' | 'warehouse' | 'house';
/** Найближчий до (x0,y0) тайл, де кind можна поставити (за checkPlace). */
const free = (w: SimWorld, kind: Kind, x0: number, y0: number) => {
  let best = { x: x0, y: y0 }, bd = Infinity;
  for (let y = 0; y < SECTOR_SIZE; y += 2) for (let x = 0; x < SECTOR_SIZE; x += 2) {
    const d = Math.abs(x - x0) + Math.abs(y - y0);
    if (d < bd && checkPlace(w, 0, kind, x, y) === null) { bd = d; best = { x, y }; }
  }
  return best;
};
/** Координати (cx,cy) — у клітинках навігації; будівля ставиться в найближче вільне місце. */
const place = (w: SimWorld, kind: Kind, cx: number, cy: number) => {
  const { x, y } = free(w, kind, (cx + OFF) * 4, (cy + OFF) * 4);
  const r = applyCommand(w, { player: 'p', seq: 1, cmd: { type: 'place_building', kind, sector: 0, cell: { x, y } } });
  expect(r.ok, String(r.reason)).toBe(true);
  return w.state.buildings[w.state.buildings.length - 1];
};
const maxOf = (a: ArrayLike<number>): number => { let m = 0; for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i]; return m; };
const run = (w: SimWorld, t: number) => { for (let i = 0; i < t; i++) stepWorld(w); };
const hall = (w: SimWorld) => w.state.buildings[0];

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

  it('дороги: невеликий гак до дороги вигідний, великий — ні; швидкість +10..15%', () => {
    const S = SECTOR_CELLS;
    const grid = (roadRow: number) => {
      const g = { blocked: new Uint8Array(S * S), cellStage: new Uint8Array(S * S), forest: new Uint8Array(S * S) };
      for (let x = 0; x < S; x++) g.cellStage[roadRow * S + x] = TrailStage.Paved;
      return g;
    };
    const rowsOf = (p: Int32Array) => new Set(Array.from(p, (c) => Math.floor(c / S)));
    setRoadPull(1);
    expect(rowsOf(findPath(grid(12), 2, 10, 60, 10)!).has(12)).toBe(true); // гак 2 клітинки — іде по дорозі
    expect(rowsOf(findPath(grid(30), 2, 10, 60, 10)!).has(30)).toBe(false); // гак 20 — напряму
    setRoadPull(0);
    expect(rowsOf(findPath(grid(12), 2, 10, 60, 10)!).has(12)).toBe(false); // тяги немає
    setRoadPull(1);
    for (const st of [TrailStage.Trampled, TrailStage.Road, TrailStage.Paved]) {
      expect(ROAD_SPEED_MULT[st]).toBeGreaterThanOrEqual(1.1);
      expect(ROAD_SPEED_MULT[st]).toBeLessThanOrEqual(1.15);
    }
  });

  it('стежки не посилюються безмежно: стадія обмежена Paved', () => {
    const w = setup();
    for (let k = 0; k < 3; k++) staffBuilding(w, 'p', place(w, 'lumberjack', 30 + k * 3, 36).id, 2);
    run(w, 3000);
    const rt = w.sectors.get(0)!;
    expect(rt.stage.reduce((m, v) => Math.max(m, v), 0)).toBeLessThanOrEqual(TrailStage.Paved);
    const roadCells = rt.stage.reduce((a, s) => a + (s >= TrailStage.Road ? 1 : 0), 0);
    expect(roadCells).toBeLessThan(SECTOR_SIZE * SECTOR_SIZE * 0.1); // не весь сектор
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
    expect(rt.occ.reduce((a, v) => a + v, 0) - BORDER_OCC).toBe(t.size.w * t.size.h + wh.size.w * wh.size.h);
    applyCommand(w, { player: 'p', seq: 3, cmd: { type: 'demolish_building', building: wh.id } });
    expect(rt.occ.reduce((a, v) => a + v, 0) - BORDER_OCC).toBe(t.size.w * t.size.h);
  });

  it('стежки по тайлах: ходіння лишає вузький слід, стадії — по тайлах', () => {
    const w = setup();
    staffBuilding(w, 'p', place(w, 'lumberjack', 40, 30).id);
    run(w, 1200);
    const rt = w.sectors.get(0)!;
    const trodden = rt.trails.traffic.reduce((a, v) => a + (v > 0 ? 1 : 0), 0);
    expect(trodden).toBeGreaterThan(50);
    expect(rt.trails.traffic.length).toBe(SECTOR_SIZE * SECTOR_SIZE);
    // cellStage узгоджений зі стадіями тайлів
    for (let c = 0; c < SECTOR_CELLS * SECTOR_CELLS; c += 97) {
      const cx = c % SECTOR_CELLS, cy = Math.floor(c / SECTOR_CELLS);
      let m = 0;
      for (let y = cy * 4; y < cy * 4 + 4; y++) for (let x = cx * 4; x < cx * 4 + 4; x++) m = Math.max(m, rt.stage[y * SECTOR_SIZE + x]);
      expect(rt.cellStage[c]).toBe(m);
    }
  });

  it('міграція v2 -> v3: порожній світ переноситься, місто відхиляється з повідомленням', () => {
    const base = { version: 2, state: { buildings: [], npcs: { count: 0 }, sectors: [{ id: 0, trails: { type: 'u16', length: 4096, base64: '' } }] } };
    const ok = MIGRATIONS[2](base) as { version: number; state: { sectors: { trails: unknown }[] } };
    expect(ok.version).toBe(3);
    expect(ok.state.sectors[0].trails).toBeNull();
    expect(() => MIGRATIONS[2]({ ...base, state: { ...base.state, buildings: [{}] } })).toThrow(/нову гру/);
  });

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

  it('стежки: один прохід нічого не дає, кілька поспіль — так; стадії ростуть геометрично', () => {
    const w = setup();
    const rt = getSectorRt(w, 0);
    const tile = 5 * SECTOR_SIZE + 5;
    stepOn(w, rt, tile);
    expect(rt.stage[tile]).toBe(TrailStage.None); // один NPC один раз — не стежка
    for (let k = 0; k < 7; k++) stepOn(w, rt, tile);
    expect(rt.stage[tile]).toBe(TrailStage.Trampled); // 8 проходів
    const t = DEFAULT_TRAIL_THRESHOLDS;
    expect(t.road / t.trampled).toBeGreaterThanOrEqual(5);
    expect(t.paved / t.road).toBeGreaterThanOrEqual(5); // кожна наступна стадія набагато важча
    for (let k = 0; k < t.road; k++) stepOn(w, rt, tile);
    expect(rt.stage[tile]).toBe(TrailStage.Road);
  });

  it('згасання: готова дорога живе на порядок довше за слабкий слід, але зрештою зникає', () => {
    const w = setup();
    const rt = getSectorRt(w, 0);
    const weak = 5 * SECTOR_SIZE + 5, paved = 5 * SECTOR_SIZE + 9;
    for (let k = 0; k < 10; k++) stepOn(w, rt, weak);
    for (let k = 0; k < 600; k++) stepOn(w, rt, paved);
    expect(rt.stage[paved]).toBe(TrailStage.Paved);
    let weakDied = 0, pavedDied = 0;
    for (let call = 1; call <= 6000 && !(weakDied && pavedDied); call++) {
      w.state.tick = call;
      decayTrails(w, 50); // 50 інтервалів за виклик
      if (!weakDied && rt.trails.traffic[weak] === 0) weakDied = call * 50;
      if (!pavedDied && rt.trails.traffic[paved] === 0) pavedDied = call * 50;
    }
    expect(weakDied).toBeGreaterThan(0); // слабкий слід зникає
    expect(pavedDied).toBeGreaterThan(0); // і дорога зрештою заростає, якщо ніхто не ходить
    expect(pavedDied).toBeGreaterThanOrEqual(weakDied * 10); // але на порядок довше
    expect(weakDied).toBeGreaterThan(500); // і слабкий слід живе довго (сотні інтервалів = години гри), а не одразу
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

  it('стежки: трафік росте, стадія підіймається, потім згасає', () => {
    const w = setup(2);
    const lj = place(w, 'lumberjack', 36, 30);
    staffBuilding(w, 'p', lj.id);
    run(w, 1500);
    const rt = w.sectors.get(0)!;
    const max = maxOf(rt.trails.traffic);
    expect(max).toBeGreaterThanOrEqual(DEFAULT_TRAIL_THRESHOLDS.trampled);
    expect(rt.stage.some((s) => s >= TrailStage.Trampled)).toBe(true);
    for (const id of [...lj.workers]) applyCommand(w, { player: 'p', seq: 5, cmd: { type: 'unassign_worker', npc: id } });
    run(w, 100);
    decayTrails(w, 3000); // довго ніхто не ходить
    expect(maxOf(rt.trails.traffic)).toBeLessThan(max);
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

describe('склади і ручне керування працівниками', () => {
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
    n.stats[1] = 150; n.perks[0] = 3;
    const back = deserialize(serialize(w));
    expect(back.state.npcs.stats[1]).toBe(150);
    expect(back.state.npcs.perks[0]).toBe(3);
    expect(back.state.npcs.nameId[0]).toBe(n.nameId[0]);
    const old = serialize(w) as unknown as { npcs: Record<string, unknown> };
    delete old.npcs.stats; delete old.npcs.nameId; delete old.npcs.perks;
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
const idleOf = (w: SimWorld): number => w.state.npcs.alive.findIndex((a, i) => a === 1 && w.npc.workplace[i] < 0);

describe('прохідність за розміром NPC', () => {
  /** Стіна через увесь сектор із проходом шириною gap тайлів. Повертає маршрут для класу s крізь прохід. */
  const wall = (gap: number, s: 1 | 2) => {
    const w = setup(11);
    const rt = getSectorRt(w, 0);
    const gx = 400, y = 500;
    const block = (x0: number, x1: number) => markFootprint(rt, { cell: { x: x0, y }, size: { w: x1 - x0, h: 8 } } as never, 1);
    block(0, gx); block(gx + gap, SECTOR_SIZE);
    return { rt, route: planRoute(rt, s, gx + (s === 2 ? gap / 2 : 0.5), y - 20, gx + 1, y + 30) };
  };
  const passes = (route: number[] | null, gx: number, gap: number) => {
    if (!route) return false;
    // відрізок, що перетинає лінію стіни, має бути в межах проходу
    let px = 400.5, py = 480;
    for (let k = 0; k < route.length; k += 2) {
      const x = route[k], y = route[k + 1];
      if ((py < 500) !== (y < 508)) { const t = (500 - py) / (y - py), cx = px + (x - px) * t; if (cx < gx || cx > gx + gap) return false; }
      px = x; py = y;
    }
    return true;
  };

  it('прохід 1 тайл: малий проходить, стандартний ні', () => {
    expect(wall(1, 1).route).not.toBeNull();
    expect(passes(wall(1, 1).route, 400, 1)).toBe(true);
    expect(wall(1, 2).route).toBeNull();
  });
  it('прохід 2 тайли: проходять обидва', () => {
    expect(wall(2, 1).route).not.toBeNull();
    const r2 = wall(2, 2).route;
    expect(r2).not.toBeNull();
    expect(passes(r2, 400, 2)).toBe(true);
  });
});
