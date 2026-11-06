import type { BuildingState } from '../shared';
import { PROFESSIONS } from '../shared';
import { DEFAULT_WORKERS, JOB_OF, MAX_WORKERS } from './balance';
import type { SimWorld } from './world';

/** Зняти NPC з роботи (стає вільним). */
export function unassignNpc(w: SimWorld, npc: number): void {
  const cur = w.npc.workplace[npc];
  const b = cur >= 0 ? w.byId.get(cur) : undefined;
  if (b) b.workers = b.workers.filter((id) => id !== npc);
  const n = w.state.npcs;
  w.npc.workplace[npc] = -1; w.npc.phase[npc] = 0; w.npc.path[npc] = null;
  n.profession[npc] = 0; n.task[npc] = 0;
  n.carryAmount[npc] = 0; n.carryKind[npc] = 255; w.npc.stage[npc] = 0; // ноша губиться
}

/** Посадити NPC на роботу в будівлі (без перевірок: їх робить виклик). */
export function assignNpc(w: SimWorld, npc: number, b: BuildingState): void {
  unassignNpc(w, npc);
  w.npc.manual[npc] = 0;
  b.workers.push(npc);
  w.npc.workplace[npc] = b.id;
  w.state.npcs.profession[npc] = PROFESSIONS.indexOf(JOB_OF[b.kind]!);
}

/** Скільки місць відкрито зараз: бажана кількість (workerCap) або типова для виду, не більше за MAX_WORKERS. */
export const slotsOf = (b: BuildingState): number =>
  Math.min(MAX_WORKERS[b.kind] ?? 0, b.workerCap ?? DEFAULT_WORKERS[b.kind] ?? MAX_WORKERS[b.kind] ?? 0);

export const hasVacancy = (b: BuildingState): boolean =>
  b.progress >= 1 && !!JOB_OF[b.kind] && b.workers.length < slotsOf(b);

/**
 * Автопризначення: кожен вільний NPC йде на вакантне місце в будівлі свого гравця й сектора;
 * перевага тій, де менше працівників (рівномірно), далі ближчій до NPC. Так новий житель із дому
 * працює і в старих будівлях, а не лише в щойно збудованих.
 */
export function autoStaffIdle(w: SimWorld): number {
  const n = w.state.npcs;
  let done = 0;
  for (let i = 0; i < n.capacity; i++) {
    if (!n.alive[i] || w.npc.workplace[i] >= 0 || w.npc.manual[i]) continue;
    const owner = w.state.players[n.owner[i]]?.id;
    let best: BuildingState | null = null, bk = Infinity;
    for (const b of w.state.buildings) {
      if (b.owner !== owner || b.sector !== n.sector[i] || b.paused || !hasVacancy(b)) continue;
      const key = b.workers.length * 1e6 + Math.abs(b.entrance.x - n.x[i]) + Math.abs(b.entrance.y - n.y[i]);
      if (key < bk) { bk = key; best = b; }
    }
    if (!best) continue;
    assignNpc(w, i, best);
    done++;
  }
  return done;
}
