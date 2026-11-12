import { describe, expect, it } from 'vitest';
import { DEFAULT_TRAIL_THRESHOLDS, SECTOR_CELLS, SECTOR_SIZE, TrailStage, ROAD_SPEED_MULT } from '../../shared';
import { decayTrails, stepOn, applyCommand, getSectorRt, staffBuilding } from '../index';
import { findPath, setRoadPull } from '../path';
import { setup, place, maxOf, run } from '../testkit';

describe('стежки й дороги', () => {
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
    // частковий маршрут: дорога лише на частині шляху (x 20..40, рядок 12) — іде нею, потім прямо до цілі
    const part = grid(12); part.cellStage.fill(0);
    for (let x = 20; x <= 40; x++) part.cellStage[12 * S + x] = TrailStage.Paved;
    const pp = findPath(part, 2, 10, 60, 10)!;
    expect(Array.from(pp).filter((c) => Math.floor(c / S) === 12).length).toBeGreaterThanOrEqual(15);
    expect(Math.floor(pp[pp.length - 1] / S)).toBe(10);
    for (let x = 20; x <= 40; x++) expect(pp.includes(12 * S + x)).toBe(true); // вся дорога пройдена
    expect(pp[pp.length - 1]).toBe(10 * S + 60); // далі — до цілі
    // детермінованість
    expect(Array.from(findPath(part, 2, 10, 60, 10)!)).toEqual(Array.from(pp));
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
});
