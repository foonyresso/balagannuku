import { describe, expect, it } from 'vitest';
import { PROFESSIONS } from '../shared';
import { FOOTPRINT } from '../sim/balance';
import { ATLAS_TILES, BUILDING_GRID, NPC_KIT, TREE_TILES_PX } from './spriteKit';

describe('кіт спрайтів', () => {
  const ok = (n: number) => Number.isInteger(n) && n >= -1 && n < ATLAS_TILES;
  it('кожна будівля має прямокутну сітку з коректними індексами й хоч одну плитку', () => {
    for (const k of Object.keys(FOOTPRINT)) expect(BUILDING_GRID[k as keyof typeof BUILDING_GRID], k).toBeDefined();
    for (const [k, g] of Object.entries(BUILDING_GRID)) {
      expect(g.every((r) => r.length === g[0].length), k).toBe(true);
      expect(g.flat().every(ok), k).toBe(true);
      expect(g.flat().some((n) => n >= 0), k).toBe(true);
    }
  });
  it('кожна професія має тіло, предмети — у межах атласу', () => {
    for (const p of PROFESSIONS) {
      const k = NPC_KIT[p];
      expect(k, p).toBeDefined();
      expect([k.body, k.item ?? 0, k.shield ?? 0].every(ok), p).toBe(true);
    }
    expect(NPC_KIT.hero.item).toBeDefined();
    expect(NPC_KIT.hero.shield).toBeDefined();
  });
  it('дерева в межах атласу', () => expect(TREE_TILES_PX.every(ok)).toBe(true));
});
