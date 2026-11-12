import { autoStaffIdle } from './assign';
import { rollFlowWindow } from './flow';
import { hungerTick } from './jobs/eat';
import { stepNpc } from './jobs/npc';
import { growthTick } from './systems/growth';
import { housesTick } from './systems/population';
import { syncPlayerResources } from './systems/resources';
import { emitTrailEvents, trailsTick } from './systems/trails';
import type { SimWorld } from './world';

export { PHASE } from './jobs/consts';
export { countPop } from './systems/population';
export { syncPlayerResources } from './systems/resources';
export { decayTrails, stepOn } from './systems/trails';

/**
 * Один тік симуляції. Тут лише ПОРЯДОК: поведінка жителів — у `jobs/`, системи світу — у `systems/`.
 * Нову систему додавай окремим файлом і одним рядком тут. Порядок впливає на детермінізм: не міняй без потреби.
 * Події тіка лежать у w.events до наступного виклику.
 */
export function stepWorld(w: SimWorld): void {
  const s = w.state, n = s.npcs;
  w.events = [];
  w.stageChanges.length = 0;
  w.npc.px.set(n.x); w.npc.py.set(n.y); // «попередня» позиція для інтерполяції в рендері
  s.tick++;
  for (let i = 0; i < n.capacity; i++) if (n.alive[i]) stepNpc(w, i);
  hungerTick(w);
  trailsTick(w);
  growthTick(w);
  if (s.tick % 10 === 0) { syncPlayerResources(w); housesTick(w); autoStaffIdle(w); }
  rollFlowWindow(w);
  emitTrailEvents(w);
}
