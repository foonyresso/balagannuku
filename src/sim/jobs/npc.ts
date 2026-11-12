import { EAT_BELOW } from '../balance';
import { getSectorRt, type SimWorld } from '../world';
import { carryDrop, carryPick, planCarrier } from './carrier';
import type { JobFn } from './common';
import { CARRIER, FARMER, FISHER, PHASE, SAWYER, taskId } from './consts';
import { eat, planEat } from './eat';
import { farmWalk, farmWork, planFarmer } from './farm';
import { planGather, walkHome, walkNode, workHome, workNode } from './gather';
import { walkDeposit } from './logistics';
import { planSawyer, walkMill, walkTake, workMill } from './sawmill';

/**
 * Один тік одного NPC: машина станів за фазою (PHASE). Тут лише розподіл: логіка кожної професії — у своєму файлі.
 * Нова професія: файл із планом і обробниками фаз, рядок у `plan` і рядки в `stepNpc`.
 */

/** Що робити далі: спершу їжа, потім план професії. Решта професій (лісоруб, каменяр, мисливець) — добувачі. */
const plan: JobFn = (w, i, rt, b) => {
  const n = w.state.npcs;
  if (n.fullness[i] < EAT_BELOW && planEat(w, i, rt, b)) return;
  const p = n.profession[i];
  if (p === FARMER || p === FISHER) return planFarmer(w, i, rt, b);
  if (p === CARRIER) return planCarrier(w, i, rt, b);
  if (p === SAWYER) return planSawyer(w, i, rt, b);
  return planGather(w, i, rt, b);
};

export function stepNpc(w: SimWorld, i: number): void {
  const n = w.state.npcs, npc = w.npc;
  const wp = npc.workplace[i];
  const b = wp >= 0 ? w.byId.get(wp) : undefined;
  if (!b) { npc.workplace[i] = -1; n.task[i] = taskId('idle'); npc.path[i] = null; return; }
  const rt = getSectorRt(w, b.sector);
  switch (npc.phase[i]) {
    case PHASE.PLAN: plan(w, i, rt, b); break;
    case PHASE.WAIT: if (--npc.timer[i] <= 0) npc.phase[i] = PHASE.PLAN; break;
    // добувачі
    case PHASE.WALK_NODE: walkNode(w, i, rt, b); break;
    case PHASE.WORK_NODE: workNode(w, i, rt, b); break;
    case PHASE.WALK_HOME: walkHome(w, i, rt, b); break;
    case PHASE.WORK_HOME: workHome(w, i, rt, b); break;
    // доставка
    case PHASE.WALK_DEPOSIT: walkDeposit(w, i, rt, b); break;
    // їжа
    case PHASE.EAT: eat(w, i, rt, b); break;
    // ферма й рибалка
    case PHASE.FARM_WALK: farmWalk(w, i, rt, b); break;
    case PHASE.FARM_WORK: farmWork(w, i, rt, b); break;
    // носій
    case PHASE.CARRY_PICK: carryPick(w, i, rt, b); break;
    case PHASE.CARRY_DROP: carryDrop(w, i, rt, b); break;
    // пиляр
    case PHASE.WALK_TAKE: walkTake(w, i, rt, b); break;
    case PHASE.WALK_MILL: walkMill(w, i, rt, b); break;
    case PHASE.WORK_MILL: workMill(w, i, rt, b); break;
  }
}
