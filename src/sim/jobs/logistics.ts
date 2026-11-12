import type { BuildingState, ResourceKind } from '../../shared';
import { RESOURCE_KINDS } from '../../shared';
import { WOOD_RESERVE } from '../balance';
import { flowEdge } from '../flow';
import { capOf, isStorage, stockOf } from '../stock';
import type { SectorRt, SimWorld } from '../world';
import { spotNear, wait, type JobFn } from './common';
import { PHASE, taskId } from './consts';
import { advance, setPath } from './move';

/** Логістика: куди нести ресурс і звідки його брати. Правила — docs/systems/logistics.md. */

/** Найближче сховище свого гравця в секторі, що має запас (needStock) — для забору. */
export function nearestStorage(rt: SectorRt, owner: string, x: number, y: number, kind: ResourceKind, needStock: number): BuildingState | null {
  let best: BuildingState | null = null, bd = Infinity;
  for (const b of rt.buildings) {
    if (!isStorage(b) || b.owner !== owner || b.progress < 1 || stockOf(b, kind) < needStock) continue;
    const d = Math.abs(b.entrance.x - x) + Math.abs(b.entrance.y - y);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

/** Дерево на складах гравця в секторі. */
function storageWood(rt: SectorRt, owner: string): number {
  let t = 0;
  for (const b of rt.buildings) if (isStorage(b) && b.owner === owner) t += stockOf(b, 'wood');
  return t;
}

/**
 * Куди віднести ресурс: найближча будівля, що його приймає й має вільне місце — споживач
 * (лісопильня з буфером колод) або склад. При рівній відстані споживач має перевагу.
 */
export function nearestAcceptor(rt: SectorRt, owner: string, x: number, y: number, kind: ResourceKind): BuildingState | null {
  let best: BuildingState | null = null, bd = Infinity;
  const reserveOk = kind !== 'wood' || storageWood(rt, owner) >= WOOD_RESERVE;
  for (const b of rt.buildings) {
    if (b.owner !== owner || b.progress < 1 || stockOf(b, kind) >= capOf(b, kind)) continue;
    // Переробка після будівництва: на паузі або при дефіциті дерева на складі колоди їй не несуть.
    if (!isStorage(b) && (b.paused || !reserveOk)) continue;
    if (!isStorage(b) && b.workers.length === 0) continue;
    const d = Math.abs(b.entrance.x - x) + Math.abs(b.entrance.y - y) - (isStorage(b) ? 0 : 0.5);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

/** План: віднести ношу до найближчого приймача. */
export const planDeposit: JobFn = (w, i, rt, b) => {
  const n = w.state.npcs, kind = RESOURCE_KINDS[n.carryKind[i]];
  const st = nearestAcceptor(rt, b.owner, n.x[i], n.y[i], kind);
  if (!st) return wait(w, i, b, 'no_storage');
  { const sp = spotNear(rt, st, i); if (!setPath(w, i, rt, sp.x, sp.y)) return wait(w, i, b, 'no_path'); }
  n.targetBuilding[i] = st.id;
  w.npc.phase[i] = PHASE.WALK_DEPOSIT; n.task[i] = taskId('carry');
};

/** Покласти ношу в споруду `st`, скільки влізе; потік записується від `from`. */
export function unload(w: SimWorld, i: number, from: BuildingState, st: BuildingState | undefined): void {
  const n = w.state.npcs, k = RESOURCE_KINDS[n.carryKind[i]];
  if (!st) return;
  const put = Math.min(n.carryAmount[i], capOf(st, k) - stockOf(st, k));
  if (put > 0) {
    st.stock[k] = stockOf(st, k) + put;
    n.carryAmount[i] -= put;
    flowEdge(w, from.id, st.id, k, put);
  }
}

/** Фаза WALK_DEPOSIT: дійшов до приймача — розвантажитись; не влізло — чекати. */
export const walkDeposit: JobFn = (w, i, rt, b) => {
  const n = w.state.npcs, npc = w.npc;
  if (!advance(w, i, rt)) return;
  unload(w, i, b, w.byId.get(n.targetBuilding[i]));
  if (n.carryAmount[i] === 0) { n.carryKind[i] = 255; npc.stage[i] = 0; npc.phase[i] = PHASE.PLAN; } else wait(w, i, b, 'storage_full');
};
