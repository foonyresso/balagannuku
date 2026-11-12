import { FLOW_PEOPLE } from '../../shared';
import { FOOD_RESTORE, FULL_MAX, HUNGER_INTERVAL } from '../balance';
import { flowConsume, flowEdge } from '../flow';
import { stockOf } from '../stock';
import type { SimWorld } from '../world';
import { spotNear, wait, type JobFn } from './common';
import { FARMER, FISHER, HUNTER, PHASE, taskId } from './consts';
import { nearestStorage } from './logistics';
import { advance, setPath } from './move';

/** Їжа й голод: ситість спадає з часом, голодний NPC між діями йде їсти до найближчого складу. Числа — balance/people.ts. */

/** Виробники їжі працюють і на нулі ситості (повільніше), щоб не було глухого кута. */
const isFoodJob = (p: number): boolean => p === FARMER || p === HUNTER || p === FISHER;

/** Голодний NPC йде до найближчого складу з їжею. true — дію вибрано (іти їсти або чекати), false — планувати звичайно. */
export function planEat(...[w, i, rt, b]: Parameters<JobFn>): boolean {
  const n = w.state.npcs;
  const st = nearestStorage(rt, b.owner, n.x[i], n.y[i], 'food', 1);
  if (st) {
    const sp = spotNear(rt, st, i);
    if (!setPath(w, i, rt, sp.x, sp.y)) return false;
    n.targetBuilding[i] = st.id; w.npc.phase[i] = PHASE.EAT; n.task[i] = taskId('walk');
    return true;
  }
  if (n.fullness[i] === 0 && !isFoodJob(n.profession[i])) { wait(w, i, b, 'no_food'); return true; }
  return false;
}

/** Фаза EAT: дійшов до складу — з'їсти одиницю їжі. */
export const eat: JobFn = (w, i, rt) => {
  const n = w.state.npcs;
  if (!advance(w, i, rt)) return;
  const st = w.byId.get(n.targetBuilding[i]);
  if (st && stockOf(st, 'food') >= 1) {
    st.stock.food = stockOf(st, 'food') - 1;
    n.fullness[i] = Math.min(FULL_MAX, n.fullness[i] + FOOD_RESTORE);
    flowConsume(w, st.id, 'food', 1); flowEdge(w, st.id, FLOW_PEOPLE, 'food', 1);
  }
  w.npc.phase[i] = PHASE.PLAN;
};

/** Раз на HUNGER_INTERVAL тіків ситість кожного живого NPC спадає на 1. */
export function hungerTick(w: SimWorld): void {
  const n = w.state.npcs;
  if (w.state.tick % HUNGER_INTERVAL !== 0) return;
  for (let i = 0; i < n.capacity; i++) if (n.alive[i] && n.fullness[i] > 0) n.fullness[i]--;
}
