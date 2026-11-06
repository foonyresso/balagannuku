import { describe, expect, it } from 'vitest';
import type { PlayerState } from '../shared';
import { RESOURCE_KINDS } from '../shared';
import { createWorld, startCity } from '../sim';
import { claimStart } from '../sim/worldgen';
import { COMPACT_NODEGEN, configureNodegen } from '../sim/nodegen';
import { describeSel } from './info';
import { npcName } from './names';

const mk = (id: string): PlayerState => ({
  id, nickname: id, token: id, color: 1, homeSector: null, ownedSectors: [],
  resources: Object.fromEntries(RESOURCE_KINDS.map((k) => [k, 0])) as PlayerState['resources'],
});

describe('інформація про об’єкти', () => {
  it('імена стабільні й різні', () => {
    expect(npcName(5, 3)).toBe(npcName(5, 3));
    expect(new Set(Array.from({ length: 30 }, (_, i) => npcName(5, i))).size).toBeGreaterThan(15);
  });
  it('житель і ратуша описуються; зниклий об’єкт -> null', () => {
    configureNodegen(COMPACT_NODEGEN);
    const w = createWorld(3, [mk('p')]);
    claimStart(w.state, 'p', 0);
    startCity(w, 'p');
    const sector = w.state.players[0].homeSector!;
    const npc = describeSel(w, 'p', sector, { t: 'npc', id: 0 });
    expect(npc?.rows.map((r) => r[0])).toEqual(expect.arrayContaining(['Професія', 'Зараз', 'Несе']));
    const hall = describeSel(w, 'p', sector, { t: 'building', id: w.state.buildings[0].id });
    expect(hall?.title).toContain('Ратуша');
    expect(hall?.canDemolish).toBe(false);
    expect(describeSel(w, 'p', sector, { t: 'building', id: 9999 })).toBeNull();
    expect(describeSel(w, 'p', sector, { t: 'npc', id: 4000 })).toBeNull();
  });
});
