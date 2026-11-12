import { describe, expect, it } from 'vitest';
import { EQUIPMENT_SLOTS, NPC_STAT_COUNT, PERKS, PERK_SLOT_COUNT, SAVE_VERSION, dayClock, migrateSave, type SaveFile } from '../shared';
import { deserialize, serialize, stepWorld } from '../sim';
import { pack, unpack } from '../sim/pack';
import { setup } from '../sim/testkit';

/** Сейв у форматі v9: маска перків, спорядження на 4 слоти, 5 статів, без полів темного світу. */
function makeV9(): { file: unknown; oldStats: Uint8Array } {
  const w = setup();
  const s = serialize(w) as unknown as { world: Record<string, unknown>; npcs: Record<string, never> } & Record<string, unknown>;
  const cap = s.npcs.capacity as unknown as number;
  const stats = unpack<Uint8Array>(s.npcs.stats), old5 = new Uint8Array(cap * 5);
  for (let i = 0; i < cap; i++) for (let k = 0; k < 5; k++) old5[i * 5 + k] = stats[i * NPC_STAT_COUNT + k];
  old5[0] = 130; // walk першого NPC
  const mask = new Uint16Array(cap); mask[0] = 0b10101; // swift, woodcutter, lucky
  const eq = new Uint16Array(cap * 4); eq.set([9, 1, 2, 3], 0); // голова, тіло, зброя, щит
  for (const k of ['perkSlots', 'klass', 'xp', 'mana', 'gold', 'mood', 'buff', 'buffUntil', 'candidateUntil']) delete (s.npcs as Record<string, unknown>)[k];
  Object.assign(s.npcs, { stats: pack(old5), perks: pack(mask), equipment: pack(eq) });
  delete s.world.clockShift;
  for (const k of ['walls', 'nextWallId', 'monsters', 'nextMonsterId', 'pois', 'nextPoiId']) delete s[k];
  return { file: { magic: 'balagannuku-save', version: 9, savedAt: '', gameVersion: 't', compression: 'none', state: s }, oldStats: old5 };
}

describe('міграція сейва v9 -> v10 (темний світ)', () => {
  it('версія піднята, нові поля стану з нормою', () => {
    expect(SAVE_VERSION).toBe(10);
    const { file } = makeV9();
    const f: SaveFile = migrateSave(file as { version: number });
    expect(f.version).toBe(SAVE_VERSION);
    const st = f.state;
    expect(st.world.clockShift).toBe(0);
    expect([st.walls, st.monsters, st.pois]).toEqual([[], [], []]);
    expect([st.nextWallId, st.nextMonsterId, st.nextPoiId]).toEqual([1, 1, 1]);
  });

  it('NPC: перки в слотах, спорядження 6 слотів, стати зі старим stride, нові поля нормою', () => {
    const { file } = makeV9();
    const w = deserialize(migrateSave(file as { version: number }).state);
    const n = w.state.npcs;
    expect(n.perkSlots.length).toBe(n.capacity * PERK_SLOT_COUNT);
    const keys = [...n.perkSlots.subarray(0, PERK_SLOT_COUNT)].map((v) => (v ? PERKS[(v >> 8) - 1].key : null));
    expect(keys).toEqual(['swift', 'woodcutter', null, 'lucky', null]);
    expect(n.equipment.length).toBe(n.capacity * EQUIPMENT_SLOTS);
    expect([...n.equipment.subarray(0, EQUIPMENT_SLOTS)]).toEqual([2, 3, 1, 0, 0, 0]); // зброя, друга рука, броня; голова губиться
    expect(n.stats.length).toBe(n.capacity * NPC_STAT_COUNT);
    expect(n.stats[0]).toBe(130);
    expect([...n.stats.subarray(5, NPC_STAT_COUNT)]).toEqual([100, 100, 100, 100, 100]);
    expect(n.klass[0]).toBe(0);
    expect(n.gold[0]).toBe(0);
    expect(n.mood[0]).toBe(50);
    expect(n.candidateUntil[0]).toBe(0);
    expect((n as unknown as Record<string, unknown>).perks).toBeUndefined();
  });

  it('після міграції світ іде далі, годинник — день, повторний round-trip стабільний', () => {
    const { file } = makeV9();
    const w = deserialize(migrateSave(file as { version: number }).state);
    for (let i = 0; i < 50; i++) stepWorld(w);
    expect(dayClock(w.state.tick, w.state.world.clockShift).phase).toBe('day');
    const a = JSON.stringify(serialize(w));
    expect(JSON.stringify(serialize(deserialize(JSON.parse(a))))).toBe(a);
  });
});
