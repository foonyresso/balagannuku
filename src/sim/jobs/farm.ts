import type { BuildingState } from '../../shared';
import { FARM_CARRY, FARM_TICKS, FISH_SHORE_RADIUS, FISH_TICKS, SOLID_RECT } from '../balance';
import { flowEdge, flowProduce } from '../flow';
import { hash2 } from '../rng';
import { T as TILES, shoreNear, type SectorRt } from '../world';
import { hungerEff, mul, spotNear, wait, workTicks, type JobFn } from './common';
import { FISHER, FOOD, PHASE, ST_GATHER, taskId } from './consts';
import { planDeposit } from './logistics';
import { advance, setPath } from './move';

/** Фермер і рибалка: працюють на місці (поле / берег), їжа з'являється за час роботи. */

/** Точка на полі ферми (поза хатою): у кожного фермера своя, змінюється з кожним зібраним врожаєм. */
function fieldSpot(rt: SectorRt, b: BuildingState, i: number, salt: number): { x: number; y: number } {
  const sr = SOLID_RECT[b.kind];
  for (let k = 0; k < 8; k++) {
    const x = b.cell.x + 1 + Math.floor(hash2(i + k * 31, b.id, 13 + salt) * (b.size.w - 2));
    const y = b.cell.y + 1 + Math.floor(hash2(b.id + k * 17, i, 19 + salt) * (b.size.h - 2));
    const inHut = !!sr && x <= b.cell.x + sr.x + sr.w && y <= b.cell.y + sr.y + sr.h;
    if (!inHut && !rt.occ[y * TILES + x]) return { x, y };
  }
  return { x: b.entrance.x, y: b.entrance.y };
}

/** План: іде до ферми, працює на полі (1 од. їжі за FARM_TICKS), набравши FARM_CARRY — несе до найближчого приймача. */
export const planFarmer: JobFn = (w, i, rt, farm) => {
  const n = w.state.npcs;
  if (n.carryAmount[i] >= FARM_CARRY) return planDeposit(w, i, rt, farm);
  let sp = farm.kind === 'farm' ? fieldSpot(rt, farm, i, w.state.tick % 97) : spotNear(rt, farm, i);
  if (n.profession[i] === FISHER) { // риба: стоїмо на березі
    const sh = shoreNear(w, rt.id, farm.entrance.x, farm.entrance.y, FISH_SHORE_RADIUS + 4);
    if (!sh) return wait(w, i, farm, 'no_water');
    sp = { x: sh.x, y: sh.y };
  }
  if (!setPath(w, i, rt, sp.x, sp.y)) return wait(w, i, farm, 'no_path');
  w.npc.phase[i] = PHASE.FARM_WALK; n.task[i] = taskId('walk');
};

/** Фаза FARM_WALK: дійшов до місця роботи — працювати. */
export const farmWalk: JobFn = (w, i, rt, b) => {
  const n = w.state.npcs, npc = w.npc;
  if (!advance(w, i, rt)) return;
  npc.phase[i] = PHASE.FARM_WORK; n.task[i] = taskId('work');
  npc.timer[i] = Math.max(1, Math.round(workTicks(b, b.kind === 'fisher' ? FISH_TICKS : FARM_TICKS) / (mul(w, i, ST_GATHER) * hungerEff(w, i))));
};

/** Фаза FARM_WORK: вироблено одиницю їжі. */
export const farmWork: JobFn = (w, i, _rt, b) => {
  const n = w.state.npcs, npc = w.npc;
  if (--npc.timer[i] > 0) return;
  w.why.delete(b.id);
  n.carryKind[i] = FOOD; n.carryAmount[i]++; npc.stage[i] = 0;
  flowProduce(w, b.id, 'food', 1); flowEdge(w, 0, b.id, 'food', 1);
  npc.phase[i] = PHASE.PLAN;
};
