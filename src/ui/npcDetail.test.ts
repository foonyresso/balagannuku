import { describe, expect, it } from 'vitest';
import { NPC_STAT_COUNT, PERK_SLOT_COUNT, packPerk } from '../shared';
import { npcDetail } from './npcDetail';
import type { SimWorld } from '../sim';

describe('npcDetail', () => {
  it('стати з відхиленням мають напрям, перки перелічені, size прихований', () => {
    const stats = new Array(NPC_STAT_COUNT).fill(0);
    stats.splice(0, NPC_STAT_COUNT, 130, 100, 80, 25, 2, 100, 100, 100, 100, 100);
    const w = { state: { npcs: { stats, perkSlots: [packPerk(0, 128), packPerk(2, 128), ...new Array(PERK_SLOT_COUNT - 2).fill(0)] } } } as unknown as SimWorld;
    const d = npcDetail(w, 0);
    expect(d.stats.map((s) => s.key)).toEqual(['walk', 'carry', 'gather', 'rare']);
    expect(d.stats.map((s) => s.dir)).toEqual([1, 0, -1, 1]);
    expect(d.stats[3].text).toBe('2.5%');
    expect(d.perks.length).toBe(2);
  });
});
