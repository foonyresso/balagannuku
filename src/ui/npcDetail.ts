import { NPC_STATS, NPC_STAT_BASE, NPC_STAT_COUNT, PERKS, hasPerk, type NpcStat } from '../shared';
import type { SimWorld } from '../sim';
import { PERK_TXT, STAT_TXT } from './info';

export interface StatView { key: NpcStat; label: string; text: string; dir: -1 | 0 | 1; /** Ширина смужки, 0..100 (50 = норма). */ fill: number }
export interface NpcDetail { stats: StatView[]; perks: string[] }

/** Стати й перки жителя для картки. Стати в % (100 = норма), rare — проміле; size не показуємо. */
export function npcDetail(w: SimWorld, id: number): NpcDetail {
  const n = w.state.npcs;
  const stats: StatView[] = [];
  for (let s = 0; s < NPC_STAT_COUNT; s++) {
    const key = NPC_STATS[s];
    if (!STAT_TXT[key]) continue;
    const v = n.stats[id * NPC_STAT_COUNT + s], base = NPC_STAT_BASE[s];
    stats.push({
      key, label: STAT_TXT[key], dir: v > base ? 1 : v < base ? -1 : 0,
      text: key === 'rare' ? `${(v / 10).toFixed(1)}%` : `${v}%`,
      fill: Math.max(2, Math.min(100, v / 2)),
    });
  }
  return { stats, perks: PERKS.filter((p) => hasPerk(n.perks[id], p)).map((p) => PERK_TXT[p]) };
}
