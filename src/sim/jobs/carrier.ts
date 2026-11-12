import type { BuildingState } from '../../shared';
import { RESOURCE_KINDS } from '../../shared';
import { CARRIER_CAP } from '../balance';
import { stockOf } from '../stock';
import { mul, spotNear, wait, type JobFn } from './common';
import { PHASE, ST_CARRY, taskId } from './consts';
import { unload } from './logistics';
import { advance, setPath } from './move';

/** Носій підскладу: бере запас підскладу (до CARRIER_CAP) -> несе в найближчу ратушу -> назад. */

/** Найбільший запас у будівлі (вид ресурсу) або -1. */
function biggestStock(b: BuildingState): number {
  let best = -1, bv = 0;
  RESOURCE_KINDS.forEach((k, idx) => { const v = stockOf(b, k); if (v > bv) { bv = v; best = idx; } });
  return best;
}

export const planCarrier: JobFn = (w, i, rt, wh) => {
  const n = w.state.npcs, npc = w.npc;
  if (n.carryAmount[i] > 0) {
    let hall: BuildingState | null = null, bd = Infinity;
    for (const b of rt.buildings) {
      if (b.kind !== 'townhall' || b.owner !== wh.owner || b.progress < 1) continue;
      const d = Math.abs(b.entrance.x - n.x[i]) + Math.abs(b.entrance.y - n.y[i]);
      if (d < bd) { bd = d; hall = b; }
    }
    if (!hall) return wait(w, i, wh, 'no_storage');
    const sp = spotNear(rt, hall, i);
    if (!setPath(w, i, rt, sp.x, sp.y)) return wait(w, i, wh, 'no_path');
    n.targetBuilding[i] = hall.id; npc.phase[i] = PHASE.CARRY_DROP; n.task[i] = taskId('carry');
    return;
  }
  if (biggestStock(wh) < 0) return wait(w, i, wh, 'no_stock', false);
  const sp = spotNear(rt, wh, i);
  if (!setPath(w, i, rt, sp.x, sp.y)) return wait(w, i, wh, 'no_path');
  npc.phase[i] = PHASE.CARRY_PICK; n.task[i] = taskId('walk');
};

/** Фаза CARRY_PICK: дійшов до підскладу — взяти найбільший запас. */
export const carryPick: JobFn = (w, i, rt, b) => {
  const n = w.state.npcs, npc = w.npc;
  if (!advance(w, i, rt)) return;
  const k = biggestStock(b);
  if (k >= 0) {
    const kind = RESOURCE_KINDS[k];
    const take = Math.min(stockOf(b, kind), Math.max(1, Math.round(CARRIER_CAP * mul(w, i, ST_CARRY))));
    b.stock[kind] = stockOf(b, kind) - take;
    n.carryKind[i] = k; n.carryAmount[i] = take; npc.stage[i] = 0;
  }
  npc.phase[i] = PHASE.PLAN;
};

/** Фаза CARRY_DROP: дійшов до ратуші — розвантажитись. */
export const carryDrop: JobFn = (w, i, rt, b) => {
  const n = w.state.npcs, npc = w.npc;
  if (!advance(w, i, rt)) return;
  unload(w, i, b, w.byId.get(n.targetBuilding[i]));
  if (n.carryAmount[i] === 0) { n.carryKind[i] = 255; npc.phase[i] = PHASE.PLAN; } else wait(w, i, b, 'storage_full');
};
