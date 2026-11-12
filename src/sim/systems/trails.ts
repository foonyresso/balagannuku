import { ROAD_ATTACH_MIN_STAGE, TRAIL_DECAY_INTERVAL, TRAIL_MAX, TRAIL_STEP_ADD, stageFromTraffic } from '../../shared';
import { ROAD_CHECK_INTERVAL, TRAIL_DECAY_BY_STAGE } from '../balance';
import { hash2 } from '../rng';
import { T as TILES, cellOfTile, refreshCellStage, type SectorRt, type SimWorld } from '../world';

/** Стежки: трафік від ходіння, згасання, прикріплення споруд до доріг, події зміни стадій. Опис — docs/systems/trails.md. */

/** NPC увійшов у тайл `t`: додати трафік і, якщо треба, підняти стадію. */
export function stepOn(w: SimWorld, rt: SectorRt, t: number): void {
  const tr = rt.trails.traffic;
  tr[t] = Math.min(TRAIL_MAX, tr[t] + TRAIL_STEP_ADD);
  const ns = stageFromTraffic(tr[t], rt.stage[t]);
  if (ns !== rt.stage[t]) {
    rt.stage[t] = ns;
    refreshCellStage(rt, cellOfTile(t % TILES, (t / TILES) | 0));
    w.stageChanges.push({ sector: rt.id, cell: t, stage: ns });
  }
}

/** Згасання на `steps` інтервалів одразу (звичайний тік = 1). Швидкість залежить від стадії тайла (TRAIL_DECAY_BY_STAGE). */
export function decayTrails(w: SimWorld, steps = 1): void {
  const keep = TRAIL_DECAY_BY_STAGE.map((r) => Math.pow(1 - r, steps));
  for (const rt of w.sectors.values()) {
    const t = rt.trails.traffic;
    for (let c = 0; c < t.length; c++) {
      if (!t[c]) continue;
      // Випадкове (детерміноване) округлення: слабкий трафік згасає повільно, а не зникає за один крок.
      t[c] = Math.floor(t[c] * keep[rt.stage[c]] + hash2(c, w.state.tick, 9));
      const ns = stageFromTraffic(t[c], rt.stage[c]);
      if (ns !== rt.stage[c]) {
        rt.stage[c] = ns;
        refreshCellStage(rt, cellOfTile(c % TILES, (c / TILES) | 0));
        w.stageChanges.push({ sector: rt.id, cell: c, stage: ns });
      }
    }
  }
}

/** Будівля прикріплена до дороги, якщо в межах 2 тайлів від входу є тайл стадії ≥ Road. */
function updateRoadAttached(w: SimWorld): void {
  for (const b of w.state.buildings) {
    const rt = w.sectors.get(b.sector);
    if (!rt) continue;
    let ok = false;
    for (let dy = -2; dy <= 2 && !ok; dy++) {
      for (let dx = -2; dx <= 2 && !ok; dx++) {
        const x = b.entrance.x + dx, y = b.entrance.y + dy;
        if (x >= 0 && y >= 0 && x < TILES && y < TILES && rt.stage[y * TILES + x] >= ROAD_ATTACH_MIN_STAGE) ok = true;
      }
    }
    b.roadAttached = ok;
  }
}

/** Періодичні частини системи: згасання й перевірка прикріплення. */
export function trailsTick(w: SimWorld): void {
  const tick = w.state.tick;
  if (tick % TRAIL_DECAY_INTERVAL === 0) decayTrails(w);
  if (tick % ROAD_CHECK_INTERVAL === 0) updateRoadAttached(w);
}

/** Зміни стадій за тік -> події `trail_stage_changed`, згруповані за сектором і стадією. */
export function emitTrailEvents(w: SimWorld): void {
  if (!w.stageChanges.length) return;
  const groups = new Map<number, { sector: number; stage: number; cells: number[] }>();
  for (const c of w.stageChanges) {
    const key = c.sector * 4 + c.stage;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { sector: c.sector, stage: c.stage, cells: [] }));
    g.cells.push(c.cell);
  }
  for (const g of groups.values()) w.events.push({ e: 'trail_stage_changed', ...g });
}
