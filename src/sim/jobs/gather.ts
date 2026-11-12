import type { BuildingState } from '../../shared';
import { RESOURCE_KINDS } from '../../shared';
import { CARRY_CAP, PROCESS_TICKS, WORK_RADIUS, WORK_TICKS } from '../balance';
import { flowEdge, flowProduce } from '../flow';
import { C as CELLS, NODE_STONE, NODE_TREE, TPC, nodeTile, type SectorRt, type SimWorld } from '../world';
import { hungerEff, mul, richOf, spotNear, wait, workTicks, type JobFn } from './common';
import { FOOD, HUNTER, MINER, PHASE, ST_CARRY, ST_GATHER, STONE, WOOD, taskId } from './consts';
import { planDeposit } from './logistics';
import { advance, setPath } from './move';

/**
 * Добувачі (лісоруб, каменяр, мисливець): вузол -> добування -> назад до своєї хатинки на обробку -> віднести.
 * Ресурс безкінечний: вузол лише «зрубується» візуально й відновлюється (systems/growth.ts).
 */

const { PLAN, WALK_NODE, WORK_NODE, WALK_HOME, WORK_HOME } = PHASE;
const nodeKindOf = (prof: number): number => (prof === MINER ? NODE_STONE : NODE_TREE);

/** Вузол уже обраний іншим живим NPC, який до нього йде або на ньому працює. */
function claimedByOther(w: SimWorld, rt: SectorRt, cell: number, me: number): boolean {
  const o = rt.claimBy[cell] - 1;
  return o >= 0 && o !== me && w.state.npcs.alive[o] === 1 && w.npc.aux[o] === cell &&
    (w.npc.phase[o] === WALK_NODE || w.npc.phase[o] === WORK_NODE);
}

/**
 * Найближча клітинка з вузлом даного виду (кільцями навколо входу, радіус у клітинках).
 * Віддаємо перевагу вузлам, які ніхто не обрав, щоб працівники не стовпились на одному дереві.
 */
function findNode(w: SimWorld, i: number, rt: SectorRt, b: BuildingState, kind: number): number {
  const ex = Math.floor(b.entrance.x / TPC), ey = Math.floor(b.entrance.y / TPC);
  let fallback = -1, fallbackR = 0;
  for (let r = 1; r <= WORK_RADIUS; r++) {
    if (fallback >= 0 && r > fallbackR + 6) break;
    let best = -1, bd = Infinity, bestAny = -1, bad = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      const y = ey + dy;
      if (y < 0 || y >= CELLS) continue;
      const step = Math.abs(dy) === r ? 1 : 2 * r;
      for (let dx = -r; dx <= r; dx += step) {
        const x = ex + dx;
        if (x < 0 || x >= CELLS) continue;
        const c = y * CELLS + x;
        if (rt.kind[c] !== kind) continue;
        const d = dx * dx + dy * dy;
        if (d < bad) { bad = d; bestAny = c; }
        if (d < bd && !claimedByOther(w, rt, c, i)) { bd = d; best = c; }
      }
    }
    if (best >= 0) return best;
    if (fallback < 0 && bestAny >= 0) { fallback = bestAny; fallbackR = r; }
  }
  return fallback;
}

/** План добувача: оброблене — віднести; повна ноша — до хатинки на обробку; інакше — до найближчого вузла. */
export const planGather: JobFn = (w, i, rt, b) => {
  const n = w.state.npcs, npc = w.npc;
  if (n.carryAmount[i] > 0 && npc.stage[i] === 1) return planDeposit(w, i, rt, b); // оброблене -> споживач/склад
  if (n.carryAmount[i] >= Math.max(1, Math.round(CARRY_CAP * mul(w, i, ST_CARRY)))) { // набрали рейс: спершу до своєї хатинки на обробку
    const sp = spotNear(rt, b, i);
    if (!setPath(w, i, rt, sp.x, sp.y)) return wait(w, i, b, 'no_path');
    npc.phase[i] = WALK_HOME; n.task[i] = taskId('carry');
    return;
  }
  const cell = findNode(w, i, rt, b, nodeKindOf(n.profession[i]));
  if (cell < 0) return wait(w, i, b, 'no_node');
  const nt = nodeTile(w.state.world.seed, rt.id, cell % CELLS, (cell / CELLS) | 0);
  if (!setPath(w, i, rt, nt.x, nt.y)) return wait(w, i, b, 'no_path');
  npc.aux[i] = cell; rt.claimBy[cell] = i + 1; npc.phase[i] = WALK_NODE; n.task[i] = taskId('walk');
};

/** Фаза WALK_NODE: дійшов до вузла — почати добування (якщо вузол ще на місці). */
export const walkNode: JobFn = (w, i, rt, b) => {
  const n = w.state.npcs, npc = w.npc;
  if (!advance(w, i, rt)) return;
  const c = npc.aux[i];
  if (rt.kind[c] !== nodeKindOf(n.profession[i])) { npc.phase[i] = PLAN; return; }
  npc.phase[i] = WORK_NODE; npc.timer[i] = Math.max(1, Math.round(workTicks(b, WORK_TICKS, richOf(w, b, n.profession[i])) / (mul(w, i, ST_GATHER) * hungerEff(w, i)))); n.task[i] = taskId('work');
};

/** Фаза WORK_NODE: добув одиницю (по одній за візит). Мисливець добуває дичину (їжу) в лісі. */
export const workNode: JobFn = (w, i, rt, b) => {
  const n = w.state.npcs, npc = w.npc;
  if (--npc.timer[i] > 0) return;
  const c = npc.aux[i], isStone = n.profession[i] === MINER, isGame = n.profession[i] === HUNTER;
  rt.amount[c] = 0; rt.forest[c] = 0;
  n.carryKind[i] = isStone ? STONE : isGame ? FOOD : WOOD; n.carryAmount[i]++; npc.stage[i] = 0;
  flowEdge(w, 0, b.id, RESOURCE_KINDS[n.carryKind[i]], 1);
  npc.phase[i] = PLAN;
};

/** Фаза WALK_HOME: приніс рейс до своєї хатинки — почати обробку. */
export const walkHome: JobFn = (w, i, rt, b) => {
  const n = w.state.npcs, npc = w.npc;
  if (!advance(w, i, rt)) return;
  npc.phase[i] = WORK_HOME; npc.timer[i] = Math.round(workTicks(b, PROCESS_TICKS, richOf(w, b, n.profession[i])) / hungerEff(w, i)); n.task[i] = taskId('work');
};

/** Фаза WORK_HOME: обробив (оброблене «виробляється» тут) — далі нести. */
export const workHome: JobFn = (w, i, _rt, b) => {
  const n = w.state.npcs, npc = w.npc;
  if (--npc.timer[i] > 0) return;
  w.why.delete(b.id);
  flowProduce(w, b.id, RESOURCE_KINDS[n.carryKind[i]], n.carryAmount[i]);
  npc.stage[i] = 1; npc.phase[i] = PLAN;
};
