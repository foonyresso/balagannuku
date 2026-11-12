import type { BuildingState } from '../../shared';
import { MILL_BUFFER, MILL_TICKS, WOOD_RESERVE } from '../balance';
import { flowConsume, flowEdge, flowProduce } from '../flow';
import { stockOf } from '../stock';
import type { SimWorld } from '../world';
import { hungerEff, spotNear, wait, workTicks, type JobFn } from './common';
import { PHASE, PLANKS, WOOD, taskId } from './consts';
import { nearestStorage, planDeposit } from './logistics';
import { advance, setPath } from './move';

/** Пиляр: 2 дерева -> 1 дошка. Сам добирає дерево зі складу (понад WOOD_RESERVE) і відносить дошки. */

export const planSawyer: JobFn = (w, i, rt, mill) => {
  const n = w.state.npcs, npc = w.npc;
  const carry = n.carryAmount[i] > 0 ? n.carryKind[i] : -1;
  if (carry === PLANKS) return planDeposit(w, i, rt, mill);
  if (mill.paused && carry < 0 && stockOf(mill, 'planks') === 0) return wait(w, i, mill, 'paused', false);
  if (carry === WOOD || stockOf(mill, 'wood') >= 2 || stockOf(mill, 'planks') > 0) {
    { const sp = spotNear(rt, mill, i); if (!setPath(w, i, rt, sp.x, sp.y)) return wait(w, i, mill, 'no_path'); }
    npc.phase[i] = PHASE.WALK_MILL; n.task[i] = taskId('walk');
    return;
  }
  const st = nearestStorage(rt, mill.owner, n.x[i], n.y[i], 'wood', 2 + WOOD_RESERVE);
  if (!st) return wait(w, i, mill, 'no_wood');
  { const sp = spotNear(rt, st, i); if (!setPath(w, i, rt, sp.x, sp.y)) return wait(w, i, mill, 'no_path'); }
  n.targetBuilding[i] = st.id;
  npc.phase[i] = PHASE.WALK_TAKE; n.task[i] = taskId('walk');
};

/** Пиляти, якщо є з чого; інакше забрати готові дошки й планувати далі. */
function startMill(w: SimWorld, i: number, mill: BuildingState): void {
  const n = w.state.npcs, npc = w.npc;
  if (!mill.paused && stockOf(mill, 'wood') >= 2) {
    npc.phase[i] = PHASE.WORK_MILL; npc.timer[i] = Math.round(workTicks(mill, MILL_TICKS) / hungerEff(w, i)); n.task[i] = taskId('work');
    return;
  }
  const planks = stockOf(mill, 'planks');
  if (planks > 0) {
    const take = Math.min(planks, 200);
    mill.stock.planks = planks - take;
    n.carryKind[i] = PLANKS; n.carryAmount[i] = take;
  }
  npc.phase[i] = PHASE.PLAN;
}

/** Фаза WALK_TAKE: дійшов до складу — взяти дерево понад резерв. */
export const walkTake: JobFn = (w, i, rt, b) => {
  const n = w.state.npcs, npc = w.npc;
  if (!advance(w, i, rt)) return;
  const st = w.byId.get(n.targetBuilding[i]);
  const have = st ? stockOf(st, 'wood') : 0;
  const usable = have - WOOD_RESERVE; // решта — резерв під будівництво
  if (!st || usable < 2 || b.paused) { npc.phase[i] = PHASE.PLAN; wait(w, i, b, b.paused ? 'paused' : 'no_wood'); return; }
  const take = Math.min(Math.max(2, MILL_BUFFER - stockOf(b, 'wood')), usable);
  st.stock.wood = have - take;
  n.carryKind[i] = WOOD; n.carryAmount[i] = take;
  npc.aux[i] = st.id;
  npc.phase[i] = PHASE.PLAN;
};

/** Фаза WALK_MILL: дійшов до лісопильні — скласти принесене дерево й пиляти. */
export const walkMill: JobFn = (w, i, rt, b) => {
  const n = w.state.npcs, npc = w.npc;
  if (!advance(w, i, rt)) return;
  if (n.carryAmount[i] > 0 && n.carryKind[i] === WOOD) {
    b.stock.wood = stockOf(b, 'wood') + n.carryAmount[i];
    if (npc.aux[i] >= 0) flowEdge(w, npc.aux[i], b.id, 'wood', n.carryAmount[i]);
    n.carryAmount[i] = 0; n.carryKind[i] = 255; npc.aux[i] = -1;
  }
  startMill(w, i, b);
};

/** Фаза WORK_MILL: дошка готова. */
export const workMill: JobFn = (w, i, _rt, b) => {
  const npc = w.npc;
  if (--npc.timer[i] > 0) return;
  if (stockOf(b, 'wood') >= 2) {
    b.stock.wood = stockOf(b, 'wood') - 2; b.stock.planks = stockOf(b, 'planks') + 1;
    w.why.delete(b.id); flowConsume(w, b.id, 'wood', 2); flowProduce(w, b.id, 'planks', 1);
  }
  startMill(w, i, b);
};
