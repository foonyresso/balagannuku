import { describe, expect, it } from 'vitest';
import { generateSectors } from './worldgen';
import { C, CENTER_CELL, nodeAt, NODE_NONE } from './world';
import { NODEGEN, genNode, mixNodeSeed } from './nodegen';

/** Частка вільних клітинок у колі радіуса r навколо ратуші, усереднено по секторах і сідах. */
function freeShare(r: number, seeds: number[]): number {
  let free = 0, total = 0;
  for (const seed of seeds) {
    for (const sec of generateSectors(seed, 1).slice(0, 3)) {
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
  it('далі ресурси є, але рідко: зайнято 1–15% сектора', () => {
    const occupied = 1 - freeShare(C, seeds);
    expect(occupied).toBeGreaterThan(0.01);
    expect(occupied).toBeLessThan(0.15);
  });
  it('у радіусі роботи (64) від ратуші є і дерева, і камінь для кожного сіда', () => {
    for (const seed of seeds) {
      const sec = generateSectors(seed, 1)[0];
      let trees = 0, stones = 0;
      for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
        if (Math.hypot(x - CENTER_CELL, y - CENTER_CELL) > 64) continue;
        const k = nodeAt(seed, sec, x, y)[0];
        if (k === 1) trees++; else if (k === 2) stones++;
      }
      expect(trees).toBeGreaterThan(50);
      expect(stones).toBeGreaterThan(20);
    }
  });
});

describe('безшовність: genNode залежить лише від світових координат', () => {
  /** Частка пар сусідніх клітинок по x з однаковим видом вузла (кластери → висока, шов → різкий провал). */
  const agree = (seed: number, x: number, ys: number[]) => {
    let same = 0;
    for (const y of ys) if (genNode(seed, 0.5, 0.5, x, y, 256) === genNode(seed, 0.5, 0.5, x + 1, y, 256)) same++;
    return same / ys.length;
  };
  const ys = Array.from({ length: 400 }, (_, i) => 40 + i); // далекий ліс, де вузли є
  it('на межах секторів (x = 255|256 і 511|512) немає провалу узгодженості', () => {
    for (const seed of [3, 11, 77]) {
      const s = mixNodeSeed(seed, 0);
      for (const edge of [255, 511, 767]) {
        const around = [edge - 6, edge - 4, edge - 2, edge + 2, edge + 4, edge + 6].map((x) => agree(s, x, ys));
        const mean = around.reduce((a, b) => a + b, 0) / around.length;
        expect(Math.abs(agree(s, edge, ys) - mean)).toBeLessThan(0.05);
      }
    }
  });
  it('той самий світ незалежно від того, з якого «сектора» його читають', () => {
    const s = mixNodeSeed(5, 2);
    for (let x = 500; x < 530; x++) {
      const a = genNode(s, 0.4, 0.4, x, 300, 256);
      const viaOffset = genNode(s, 0.4, 0.4, (x - 512) + 512, 300, 256); // читання через зсув сектора на цілу ширину
      expect(a).toBe(viaOffset);
    }
  });
});
