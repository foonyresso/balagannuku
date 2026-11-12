import type { BuildingState, Campfire } from '../../shared';
import { ACTIVE_MAX_TILE, ACTIVE_MIN_TILE, CAMP_MIN_SLOTS, CAMP_OFFSET, CAMP_PLAZA, CAMP_REBALANCE_TICKS } from '../../shared';
import { PHASE } from '../jobs/consts';
import { T as TILES, getSectorRt, type SectorRt, type SimWorld } from '../world';

/** Вогнище вільних жителів: де стоїть і хто з вільних біля нього. Поведінка самого жителя — `jobs/idle.ts`. */
const DECIDE = PHASE.PLAN;

/** Перша завершена ратуша гравця в секторі (вона ж «центр» міста для вогнища). */
export function hallOf(w: SimWorld, owner: string, sector: number): BuildingState | null {
  for (const b of w.state.buildings) if (b.kind === 'townhall' && b.owner === owner && b.sector === sector && b.progress >= 1) return b;
  return null;
}

/** Квадрат зони вогнища повністю в активній зоні й без зайнятих тайлів (будівлі, вода). */
function plazaFree(rt: SectorRt, x: number, y: number): boolean {
  const r = CAMP_PLAZA;
  if (x - r < ACTIVE_MIN_TILE || y - r < ACTIVE_MIN_TILE || x + r >= ACTIVE_MAX_TILE || y + r >= ACTIVE_MAX_TILE) return false;
  for (let ty = y - r; ty <= y + r; ty++) for (let tx = x - r; tx <= x + r; tx++) if (rt.occ[ty * TILES + tx]) return false;
  return true;
}

/**
 * Позиція вогнища ратуші: перед нею (нижче входу) на відстані CAMP_OFFSET; якщо там зайнято (вода, споруда) —
 * найближче вільне місце. Результат кешується (і далі не змінюється: навколо вогнища не будують).
 */
export function campfireOf(w: SimWorld, hall: BuildingState): Campfire {
  const cached = w.fires.get(hall.id);
  if (cached) return cached;
  const rt = getSectorRt(w, hall.sector);
  const nx = hall.entrance.x, ny = hall.entrance.y + CAMP_OFFSET;
  let fire: Campfire = { x: nx, y: ny };
  search: for (let r = 0; r <= 60; r++) {
    for (let dy = -r; dy <= r; dy++) {
      const step = Math.abs(dy) === r ? 1 : 2 * r;
      for (let dx = -r; dx <= r; dx += step) {
        if (plazaFree(rt, nx + dx, ny + dy)) { fire = { x: nx + dx, y: ny + dy }; break search; }
        if (step === 0) break;
      }
    }
  }
  w.fires.set(hall.id, fire);
  return fire;
}

/** Вогнище міста гравця в секторі (або null, якщо ратуші ще нема). */
export function campfireFor(w: SimWorld, owner: string, sector: number): Campfire | null {
  const hall = hallOf(w, owner, sector);
  return hall ? campfireOf(w, hall) : null;
}

/** Чи прямокутник footprint (x,y,w,h) заходить у зону вогнища ратуші цього сектора. */
export function hitsCampPlaza(w: SimWorld, sector: number, x: number, y: number, fw: number, fh: number): boolean {
  for (const b of w.state.buildings) {
    if (b.kind !== 'townhall' || b.sector !== sector) continue;
    const f = campfireOf(w, b), r = CAMP_PLAZA;
    if (x < f.x + r + 1 && x + fw > f.x - r && y < f.y + r + 1 && y + fh > f.y - r) return true;
  }
  return false;
}

/**
 * Перерозподіл слотів біля вогнища серед вільних жителів кожного (гравець, сектор): слот у ратуші-вогнища мають
 * min(вільних, CAMP_MIN_SLOTS) жителів. Чинні «вогнищники» лишаються; порожні слоти займають найближчі вільні.
 * Тих, чия роль змінилась (стали «вогнищниками» чи звільнили слот), змушуємо перепланувати дію.
 */
function rebalanceCamp(w: SimWorld): void {
  const n = w.state.npcs, npc = w.npc;
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n.capacity; i++) {
    if (!n.alive[i]) continue;
    if (npc.workplace[i] >= 0) { npc.camp[i] = -1; continue; }
    const key = n.owner[i] * 65536 + n.sector[i];
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(i);
  }
  for (const [key, group] of groups) {
    const owner = w.state.players[(key / 65536) | 0]?.id, sector = key % 65536;
    const fire = owner ? campfireFor(w, owner, sector) : null;
    const before = group.map((i) => npc.camp[i]);
    if (!fire) { for (const i of group) npc.camp[i] = -1; } else {
      const used = new Set<number>();
      for (const i of group) { const s = npc.camp[i]; if (s >= 0 && s < CAMP_MIN_SLOTS && !used.has(s)) used.add(s); else npc.camp[i] = -1; }
      for (let slot = 0; slot < CAMP_MIN_SLOTS; slot++) {
        if (used.has(slot)) continue;
        let best = -1, bd = Infinity;
        for (const i of group) {
          if (npc.camp[i] >= 0) continue;
          const d = Math.hypot(n.x[i] - fire.x, n.y[i] - fire.y);
          if (d < bd) { bd = d; best = i; }
        }
        if (best < 0) break;
        npc.camp[best] = slot; used.add(slot);
      }
    }
    group.forEach((i, k) => { if (npc.camp[i] !== before[k]) { npc.phase[i] = DECIDE; npc.path[i] = null; } });
  }
}

/** Раз на CAMP_REBALANCE_TICKS тіків розподіляє слоти біля вогнища. Один рядок у `stepWorld`. */
export function campTick(w: SimWorld): void {
  if (w.state.tick % CAMP_REBALANCE_TICKS === 0) rebalanceCamp(w);
}
