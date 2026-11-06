import { describe, expect, it } from 'vitest';
import { generateSectors } from './worldgen';
import { C, CENTER_CELL, nodeAt, NODE_NONE } from './world';
import { NODEGEN } from './nodegen';

/** Частка вільних клітинок у колі радіуса r навколо ратуші, усереднено по секторах і сідах. */
function freeShare(r: number, seeds: number[]): number {
  let free = 0, total = 0;
  for (const seed of seeds) {
    for (const sec of generateSectors(seed, 3)) {
      for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
        if (Math.hypot(x - CENTER_CELL, y - CENTER_CELL) > r) continue;
        total++;
        if (nodeAt(seed, sec, x, y)[0] === NODE_NONE) free++;
      }
    }
  }
  return free / total;
}

describe('генерація вузлів: вільний майданчик', () => {
  const seeds = [1, 7, 42, 1234, 99999];
  it('чистий майданчик навколо ратуші вільний на 100%', () => {
    expect(freeShare(NODEGEN.clearRadius - 1, seeds)).toBe(1);
  });
  it('площа майданчика ≥ 10× старої (9×9 клітинок)', () => {
    expect(Math.PI * NODEGEN.clearRadius ** 2).toBeGreaterThan(10 * 81);
  });
  it('навколо старту (радіус 32) вільно ≥ 85%', () => {
    expect(freeShare(32, seeds)).toBeGreaterThan(0.85);
  });
  it('далі ресурси є, але лишаються групами: зайнято 3–40% сектора', () => {
    const occupied = 1 - freeShare(C, seeds);
    expect(occupied).toBeGreaterThan(0.03);
    expect(occupied).toBeLessThan(0.4);
  });
});
