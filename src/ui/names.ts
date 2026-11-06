import { npcName } from '../shared';
import type { SimWorld } from '../sim';

/** Імʼя жителя з даних симуляції (nameId): однакове в усіх клієнтів. */
export const nameOf = (w: SimWorld, id: number): string => npcName(w.state.npcs.nameId[id]);
