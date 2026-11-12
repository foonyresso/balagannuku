import { HOUSE_SPAWN_INTERVAL, POP_BASE, POP_PER_HOUSE } from '../balance';
import { spawnNpc } from '../npcs';
import type { SimWorld } from '../world';

/** Населення: будинки поселяють нових жителів, поки є місце (POP_BASE + POP_PER_HOUSE на будинок). */

export function countPop(w: SimWorld, playerIdx: number): number {
  const n = w.state.npcs;
  let c = 0;
  for (let i = 0; i < n.capacity; i++) if (n.alive[i] && n.owner[i] === playerIdx) c++;
  return c;
}

/** Викликається раз на 10 тіків: кожен будинок у свій момент (за id) пробує поселити жителя. */
export function housesTick(w: SimWorld): void {
  const t = w.state.tick;
  for (const b of w.state.buildings) {
    if (b.kind !== 'house' || b.progress < 1 || (t / 10 + b.id) % (HOUSE_SPAWN_INTERVAL / 10) !== 0) continue;
    const pi = w.state.players.findIndex((p) => p.id === b.owner);
    const pop = countPop(w, pi);
    const homes = w.state.buildings.filter((x) => x.kind === 'house' && x.owner === b.owner).length;
    if (pop >= POP_BASE + POP_PER_HOUSE * homes) continue;
    spawnNpc(w, pi, b.sector, b.entrance.x, b.entrance.y);
  }
}
