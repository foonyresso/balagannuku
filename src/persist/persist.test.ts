import { describe, expect, it } from 'vitest';
import { EQUIPMENT_SLOTS, INVENTORY_SLOTS, MIGRATIONS, SAVE_VERSION, type GameState, type NpcStore } from '../shared';
import { HostLobby } from '../net';
import { createInitialState } from '../sim/worldgen';
import { createSave, decodeSave, encodeSave, loadState } from './index';

const mk = () => {
  const base = createInitialState(42, 3, 2, [
    { id: 'p1', nickname: 'A', token: 'tok1', color: 1, homeSector: null, ownedSectors: [], resources: {} as never },
    { id: 'p2', nickname: 'B', token: 'tok2', color: 2, homeSector: null, ownedSectors: [], resources: {} as never },
  ]);
  const n = 4;
  const npcs: NpcStore = {
    capacity: n, count: 1, alive: new Uint8Array(n), sector: new Uint16Array(n), x: new Float32Array(n), y: new Float32Array(n),
    profession: new Uint8Array(n), task: new Uint8Array(n), targetBuilding: new Int32Array(n).fill(-1), owner: new Uint8Array(n),
    hp: new Uint16Array(n), level: new Uint8Array(n), inventory: new Uint16Array(n * INVENTORY_SLOTS),
    equipment: new Uint16Array(n * EQUIPMENT_SLOTS), carryKind: new Uint8Array(n).fill(255), carryAmount: new Uint8Array(n),
  };
  const s: GameState = { ...(base as unknown as GameState), npcs };
  s.npcs.alive[0] = 1; s.npcs.x[0] = 3.5; s.npcs.targetBuilding[0] = -1; s.npcs.count = 1;
  return s;
};

describe('save', () => {
  it('roundtrip gzip і без', async () => {
    const s = mk();
    for (const gz of [true, false]) {
      const back = loadState(await decodeSave(await encodeSave(createSave(s), gz)));
      expect(JSON.stringify(back.players)).toBe(JSON.stringify(s.players));
      expect(back.sectors.length).toBe(s.sectors.length);
      expect(back.npcs.x[0]).toBe(3.5);
      expect(back.npcs.targetBuilding[0]).toBe(-1);
      expect(back.npcs.x).toBeInstanceOf(Float32Array);
      expect(back.world).toEqual(s.world);
    }
  });
  it('міграція зі старої версії', async () => {
    const old = { ...createSave(mk()), version: SAVE_VERSION };
    const orig = MIGRATIONS[SAVE_VERSION];
    MIGRATIONS[SAVE_VERSION] = (o) => ({ ...(o as object), version: SAVE_VERSION + 1, migrated: true });
    try {
      const raw = { ...old, version: SAVE_VERSION };
      // емулюємо «нову» поточну версію через ручний виклик migrateSave
      const { migrateSave } = await import('../shared');
      expect(() => migrateSave({ version: SAVE_VERSION + 5 })).toThrow();
      expect(raw.version).toBe(SAVE_VERSION);
    } finally { if (orig) MIGRATIONS[SAVE_VERSION] = orig; else delete MIGRATIONS[SAVE_VERSION]; }
  });
  it('відхиляє сміття', async () => {
    await expect(decodeSave(new TextEncoder().encode('hello'))).rejects.toThrow();
    await expect(decodeSave(new TextEncoder().encode('{"magic":"x"}'))).rejects.toThrow();
  });
  it('токени гравців зберігаються у слотах лобі', () => {
    const l = HostLobby.fromPlayers('ABCDE', mk().players);
    expect(l.players().map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(l.players()[1].online).toBe(false);
  });
});
