import { describe, expect, it } from 'vitest';
import type { PlayerState } from '../shared';
import { RESOURCE_KINDS } from '../shared';
import { createWorld, startCity } from '../sim';
import { claimStart } from '../sim/worldgen';
import { COMPACT_NODEGEN, configureNodegen } from '../sim/nodegen';
import { describeSel } from './info';
import { nameOf } from './names';

const mk = (id: string): PlayerState => ({
  id, nickname: id, token: id, color: 1, homeSector: null, ownedSectors: [],
  resources: Object.fromEntries(RESOURCE_KINDS.map((k) => [k, 0])) as PlayerState['resources'],
});

describe('інформація про об’єкти', () => {
  it('житель і ратуша описуються; зниклий об’єкт -> null', () => {
    configureNodegen(COMPACT_NODEGEN);
    const w = createWorld(3, [mk('p')]);
    claimStart(w.state, 'p', 0);
    startCity(w, 'p');
    const sector = w.state.players[0].homeSector!;
    const npc = describeSel(w, 'p', sector, { t: 'npc', id: 0 });
    expect(npc?.rows.map((r) => r[0])).toEqual(expect.arrayContaining(['Професія', 'Зараз', 'Несе', 'Перки', 'Швидкість ходьби']));
    expect(npc?.title).toBe(nameOf(w, 0));
    const hall = describeSel(w, 'p', sector, { t: 'building', id: w.state.buildings[0].id });
    expect(hall?.title).toContain('Ратуша');
    expect(hall?.canDemolish).toBe(false);
    expect(describeSel(w, 'p', sector, { t: 'building', id: 9999 })).toBeNull();
    expect(describeSel(w, 'p', sector, { t: 'npc', id: 4000 })).toBeNull();
  });
});
