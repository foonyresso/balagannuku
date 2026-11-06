import { describe, expect, it } from 'vitest';
import type { PlayerState } from '../shared';
import { DEFAULT_TRAIL_THRESHOLDS, RESOURCE_KINDS, SECTOR_CELLS, SECTOR_SIZE, TrailStage } from '../shared';
import { decayTrails, stepOn, residents, buildCheck, checkPlace, applyCommand, createWorld, getSectorRt, deserialize, serialize, startCity, staffBuilding, stepWorld, type SimWorld } from './index';
import { findPath, setRoadPull } from './path';
import { ROAD_SPEED_MULT } from '../shared';
import { MIGRATIONS } from '../shared';
import { FOOTPRINT } from './balance';
import { claimStart } from './worldgen';
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
const run = (w: SimWorld, t: number) => { for (let i = 0; i < t; i++) stepWorld(w); };
const hall = (w: SimWorld) => w.state.buildings[0];

describe('економіка', () => {
  it('ланцюжок: лісоруб -> склад -> лісопильня -> дошки', () => {
    const w = setup(1);
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
    expect(rt.occ.reduce((a, v) => a + v, 0)).toBe(t.size.w * t.size.h + wh.size.w * wh.size.h);
    applyCommand(w, { player: 'p', seq: 3, cmd: { type: 'demolish_building', building: wh.id } });
    expect(rt.occ.reduce((a, v) => a + v, 0)).toBe(t.size.w * t.size.h);
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

  it('автопризначення: новий житель із дому йде на вакантне місце в старій будівлі', () => {
    const w = setup();
    // 5 стартових поселенців заповнюють лісоруба; вільних немає
    const lj = place(w, 'lumberjack', 40, 30);
    expect(staffBuilding(w, 'p', lj.id)).toBe(5);
    lj.workers.slice(0, 2).forEach((id) => applyCommand(w, { player: 'p', seq: 1, cmd: { type: 'assign_worker', npc: id, profession: 'lumberjack', building: null } }));
    // зняті вручну — автопризначення їх не чіпає
    run(w, 30);
    expect(lj.workers.length).toBe(3);
    // збудували дім: з'являється житель і сам іде до лісоруба (там є вакансії)
    place(w, 'house', 20, 20);
    const before = w.state.npcs.count;
    run(w, 500);
    expect(w.state.npcs.count).toBeGreaterThan(before);
    expect(lj.workers.length).toBe(3 + (w.state.npcs.count - before));
    // потім лісопильня: наступний житель іде до неї (там менше працівників)
    const sm = place(w, 'sawmill', 24, 24);
    run(w, 700);
    expect(w.state.npcs.count).toBeGreaterThan(before + 1);
    expect(sm.workers.length).toBeGreaterThanOrEqual(1);
    expect(lj.workers.length + sm.workers.length).toBe(w.state.npcs.count - 2);
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
    expect(spread / samples).toBeGreaterThanOrEqual(3.5); // з 5 робітників видно хоча б ~4 різні місця
    const list = residents(w, 'p');
    expect(list.length).toBe(w.state.npcs.count);
    expect(list.every((r) => r.state !== 'free')).toBe(true);
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
    const max = (() => { let m = 0; for (const v of rt.trails.traffic) if (v > m) m = v; return m; })();
    expect(max).toBeGreaterThan(20);
    expect(rt.stage.some((s) => s >= TrailStage.Trampled)).toBe(true);
    for (const id of [...lj.workers]) applyCommand(w, { player: 'p', seq: 5, cmd: { type: 'unassign_worker', npc: id } });
    run(w, 2000);
    expect((() => { let m = 0; for (const v of rt.trails.traffic) if (v > m) m = v; return m; })()).toBeLessThan(max);
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
