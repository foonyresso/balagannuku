import { describe, expect, it } from 'vitest';
import { ISO_Y, ISO_Z, planeToIso } from '../projection';
import { packShelves } from './atlas';
import { B_TEXEL, BPainter, buildingCanvas } from './buildings';
import { CLASSES, CLASS_OF, WALK_FRAMES, actFrames, classOf, cycleFrame, hitFrame, toolOf, walkFrame } from './characters';
import { PROFESSIONS } from '../../shared';
import { variant } from './index';
import type { Ctx } from './pixel';

describe('атлас', () => {
  it('упаковка без перетинів і в межах ширини', () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ id: `s${i}`, w: 10 + (i * 7) % 40, h: 8 + (i * 13) % 50 }));
    const { at, width, height } = packShelves(items, 256);
    expect(at.size).toBe(60);
    const boxes = items.map((it) => ({ ...at.get(it.id)!, w: it.w, h: it.h }));
    for (const b of boxes) { expect(b.x + b.w).toBeLessThanOrEqual(width); expect(b.y + b.h).toBeLessThanOrEqual(height); }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
    }
  });
});

describe('споруди в проєкції гри', () => {
  const p = new BPainter(null as unknown as Ctx, 24, 24, 20);
  it('висота z зсуває піксель угору рівно на z·ISO_Z/текселя; глибина y — на y·ISO_Y', () => {
    const g = p.P(5, 10, 0), up = p.P(5, 10, 7), deep = p.P(5, 14, 0);
    expect(g[1] - up[1]).toBeCloseTo((7 * ISO_Z) / B_TEXEL, 6);
    expect(deep[1] - g[1]).toBeCloseTo((4 * ISO_Y) / B_TEXEL, 6);
    expect(p.P(9, 10, 0)[0] - g[0]).toBeCloseTo(4 / B_TEXEL, 6);
  });
  it('та сама формула, що planeToIso: різниця двох точок збігається', () => {
    const a = p.P(2, 3, 4), b = p.P(10, 20, 1), ia = planeToIso(2, 3, 4), ib = planeToIso(10, 20, 1);
    expect(b[0] - a[0]).toBeCloseTo((ib.x - ia.x) / B_TEXEL, 6);
    expect(b[1] - a[1]).toBeCloseTo((ib.y - ia.y) / B_TEXEL, 6);
  });
  it('якір — передній лівий кут землі; полотно вміщує дах', () => {
    const c = buildingCanvas(20, 24, 24), q = new BPainter(null as unknown as Ctx, 24, 24, 20);
    expect(q.P(0, 24, 0)).toEqual([c.ax, c.ay]);
    expect(q.P(24, 0, 20)[1]).toBeGreaterThanOrEqual(0);
    expect(c.ch).toBeGreaterThan(c.ay);
  });
});

describe('персонажі', () => {
  it('кожна професія має клас вигляду', () => {
    for (const pr of PROFESSIONS) expect(CLASSES[classOf(pr)]).toBeTruthy();
    expect(Object.values(CLASS_OF).every((c) => CLASSES[c])).toBe(true);
  });
  it('кадр ходьби прив’язаний до відстані й циклічний', () => {
    expect(walkFrame(0)).toBe(0);
    const seen = new Set(Array.from({ length: 40 }, (_, i) => walkFrame(i * 0.7)));
    expect(seen.size).toBe(WALK_FRAMES);
    expect(walkFrame(-1)).toBeGreaterThanOrEqual(0);
  });
  it('цикл дії покриває всі кадри, удар у межах циклу', () => {
    for (const cls of Object.keys(CLASSES)) {
      const tool = toolOf(cls), n = actFrames(tool);
      if (!n) continue;
      expect(hitFrame(tool)).toBeLessThan(n);
      expect(new Set(Array.from({ length: 200 }, (_, i) => cycleFrame(i / 100, 1, n))).size).toBe(n);
    }
  });
});

describe('варіанти', () => {
  it('детерміновані й у межах', () => {
    for (let i = 0; i < 100; i++) { const v = variant(i, i * 3, 5); expect(v).toBe(variant(i, i * 3, 5)); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(5); }
  });
});

describe('звірі', () => {
  it('кожен вид має вигляд, кадри ходьби/спокою/смерті й малюється в межах полотна', async () => {
    const { ANIMAL_KINDS } = await import('../../shared');
    const { ANIMAL_LOOK, animalFrameId, animalWalkFrame, registerStyleDefs } = await import('./index');
    const { spriteDef } = await import('./atlas');
    registerStyleDefs(4);
    for (const k of ANIMAL_KINDS) {
      expect(ANIMAL_LOOK[k], k).toBeTruthy();
      for (const id of [animalFrameId(k, 'idle', 0), animalFrameId(k, 'idle', 1), ...[0, 1, 2, 3].map((i) => animalFrameId(k, 'walk', i)), animalFrameId(k, 'dead', 0)]) {
        const d = spriteDef(id)!;
        expect(d, id).toBeTruthy();
        let n = 0, bad = 0;
        const ctx = { fillStyle: '', fillRect: (x: number, y: number, w: number, h: number) => { n++; if (x < 0 || y < 0 || x + w > d.w || y + h > d.h) bad++; } } as unknown as Ctx;
        d.paint(ctx);
        expect(n, id).toBeGreaterThan(10);
        expect(bad, `${id} виходить за полотно`).toBe(0);
      }
      expect(new Set(Array.from({ length: 60 }, (_, i) => animalWalkFrame(k, i))).size).toBe(4);
    }
  });
});
