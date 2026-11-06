import { PROFESSIONS, RESOURCE_KINDS } from '../shared';
import { PHASE } from './step';
import type { SimWorld } from './world';

export type ResidentState = 'free' | 'to_node' | 'working' | 'to_home' | 'processing' | 'carrying' | 'to_storage_take' | 'to_mill' | 'milling' | 'planning' | 'waiting' | 'no_path';

export interface Resident {
  id: number;
  sector: number;
  profession: string;
  workplace: number; // id будівлі або -1
  state: ResidentState;
  /** Причина очікування (для 'waiting'): no_node, no_storage, storage_full, no_wood, no_path, paused. */
  why?: string;
  carry: number; // скільки несе
  carryKind: string | null;
  processed: boolean; // несене вже оброблене
  x: number; // тайли
  y: number;
}

/** Стан кожного жителя гравця: чим зайнятий. Сума довжини списку = лічильник жителів гравця. */
export function residents(w: SimWorld, player: string): Resident[] {
  const n = w.state.npcs, out: Resident[] = [];
  for (let i = 0; i < n.capacity; i++) {
    if (!n.alive[i] || w.state.players[n.owner[i]]?.id !== player) continue;
    const wp = w.npc.workplace[i];
    let state: ResidentState = 'free', why: string | undefined;
    if (wp >= 0) {
      switch (w.npc.phase[i]) {
        case PHASE.WALK_NODE: state = 'to_node'; break;
        case PHASE.WORK_NODE: state = 'working'; break;
        case PHASE.WALK_HOME: state = 'to_home'; break;
        case PHASE.WORK_HOME: state = 'processing'; break;
        case PHASE.WALK_DEPOSIT: state = 'carrying'; break;
        case PHASE.CARRY_DROP: state = 'carrying'; break;
        case PHASE.CARRY_PICK:
        case PHASE.WALK_TAKE: state = 'to_storage_take'; break;
        case PHASE.WALK_MILL: state = 'to_mill'; break;
        case PHASE.WORK_MILL: state = 'milling'; break;
        case PHASE.WAIT: state = 'waiting'; why = w.why.get(wp); if (why === 'no_path') state = 'no_path'; break;
        default: why = w.why.get(wp); state = why ? 'waiting' : 'planning'; // PLAN: мить між діями
      }
    }
    out.push({ id: i, sector: n.sector[i], profession: PROFESSIONS[n.profession[i]], workplace: wp, state, why, carry: n.carryAmount[i], carryKind: n.carryAmount[i] ? RESOURCE_KINDS[n.carryKind[i]] : null, processed: w.npc.stage[i] === 1, x: n.x[i], y: n.y[i] });
  }
  return out;
}
