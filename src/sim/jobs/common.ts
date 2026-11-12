import type { BuildingState } from '../../shared';
import { NPC_STAT_COUNT } from '../../shared';
import { ATTACHED_WORK_MULT, HUNGRY_BELOW, HUNGRY_MULT, WAIT_TICKS } from '../balance';
import { flowStarve } from '../flow';
import { hash2 } from '../rng';
import { T as TILES, type SectorRt, type SimWorld } from '../world';
import { MINER, PHASE, taskId } from './consts';

/** Спільне для всіх професій: множники NPC, тривалість дії, очікування, точка біля споруди. */

/** Обробник фази або план професії: NPC `i` працює у споруді `b` сектора `rt`. */
export type JobFn = (w: SimWorld, i: number, rt: SectorRt, b: BuildingState) => void;

/** Ефективність від голоду: ситий 1, голодний HUNGRY_MULT (довше працює). */
export const hungerEff = (w: SimWorld, i: number): number => (w.state.npcs.fullness[i] < HUNGRY_BELOW ? HUNGRY_MULT : 1);
/** Множник NPC за статом (1 = норма). */
export const mul = (w: SimWorld, i: number, s: number): number => w.state.npcs.stats[i * NPC_STAT_COUNT + s] / 100;

/** Час дії: дорога прискорює; багатство сектора (richness) = щедрість, тобто швидкість видобутку. */
export const workTicks = (b: BuildingState, base: number, richness = 0.5): number =>
  Math.max(1, Math.round((b.roadAttached ? base * ATTACHED_WORK_MULT : base) / (0.6 + 0.8 * richness)));
export const richOf = (w: SimWorld, b: BuildingState, prof: number): number =>
  w.state.sectors[b.sector].richness[prof === MINER ? 'stone' : 'wood'] ?? 0.5;

/** Чекати WAIT_TICKS із причиною (показується в UI); starve — рахувати як простій споруди в потоках. */
export function wait(w: SimWorld, i: number, b: BuildingState, reason: string, starve = true): void {
  w.why.set(b.id, reason);
  w.npc.phase[i] = PHASE.WAIT; w.npc.timer[i] = WAIT_TICKS;
  w.state.npcs.task[i] = taskId('rest');
  w.npc.path[i] = null;
  if (starve) flowStarve(w, b.id);
}

/** Точка біля входу будівлі: у кожного NPC своя (детермінований зсув), щоб не стояли в одному тайлі. */
export function spotNear(rt: SectorRt, b: BuildingState, i: number): { x: number; y: number } {
  const h1 = hash2(i, b.id, 7), h2 = hash2(b.id, i, 11);
  const x = Math.min(TILES - 1, Math.max(0, b.entrance.x + Math.floor(h1 * 9) - 4));
  const y = Math.min(TILES - 1, b.entrance.y + Math.floor(h2 * 5));
  return rt.occ[y * TILES + x] ? { x: b.entrance.x, y: b.entrance.y } : { x, y };
}
