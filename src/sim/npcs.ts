import { TASKS } from '../shared';
import { hash2 } from './rng';
import { T, getSectorRt, type SimWorld } from './world';

/** Створити NPC у клітинці (x,y) сектора. Повертає NpcId або -1, якщо немає місця. */
export function spawnNpc(w: SimWorld, ownerIdx: number, sector: number, cx: number, cy: number): number {
  const n = w.state.npcs;
  let i = -1;
  for (let k = 0; k < n.capacity; k++) if (!n.alive[k]) { i = k; break; }
  if (i < 0) return -1;
  n.alive[i] = 1; n.count++;
  // Зсув навколо точки появи: нові жителі не складаються в один тайл (на екрані мають бути видимі всі).
  const jx = Math.floor(hash2(i, n.count, 3) * 9) - 4, jy = Math.floor(hash2(n.count, i, 5) * 4);
  let sx = Math.min(T - 1, Math.max(0, cx + jx)), sy = Math.min(T - 1, cy + jy);
  if (getSectorRt(w, sector).occ[sy * T + sx]) { sx = Math.min(T - 1, cx); sy = Math.min(T - 1, cy); }
  n.sector[i] = sector; n.x[i] = sx + 0.5; n.y[i] = sy + 0.5;
  n.profession[i] = 0; n.task[i] = TASKS.indexOf('idle'); n.targetBuilding[i] = -1;
  n.owner[i] = ownerIdx; n.hp[i] = 100; n.level[i] = 1;
  n.carryKind[i] = 255; n.carryAmount[i] = 0;
  w.npc.phase[i] = 0; w.npc.timer[i] = 0; w.npc.workplace[i] = -1; w.npc.aux[i] = -1; w.npc.path[i] = null; w.npc.tile[i] = -1; w.npc.manual[i] = 0; w.npc.stage[i] = 0;
  return i;
}
