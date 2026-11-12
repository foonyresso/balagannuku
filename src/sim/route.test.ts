import { describe, expect, it } from 'vitest';
import { SECTOR_CELLS, SECTOR_SIZE, TrailStage } from '../shared';
import { getSectorRt } from './index';
import { markFootprint } from './world';
import { planRoute } from './route';
import { setup } from './testkit';

describe('прохідність за розміром NPC', () => {
  /** Стіна через увесь сектор із проходом шириною gap тайлів. Повертає маршрут для класу s крізь прохід. */
  const wall = (gap: number, s: 1 | 2) => {
    const w = setup(11);
    const rt = getSectorRt(w, 0);
    const gx = 400, y = 500;
    const block = (x0: number, x1: number) => markFootprint(rt, { cell: { x: x0, y }, size: { w: x1 - x0, h: 8 } } as never, 1);
    block(0, gx); block(gx + gap, SECTOR_SIZE);
    return { rt, route: planRoute(rt, s, gx + (s === 2 ? gap / 2 : 0.5), y - 20, gx + 1, y + 30) };
  };
  const passes = (route: number[] | null, gx: number, gap: number) => {
    if (!route) return false;
    // відрізок, що перетинає лінію стіни, має бути в межах проходу
    let px = 400.5, py = 480;
    for (let k = 0; k < route.length; k += 2) {
      const x = route[k], y = route[k + 1];
      if ((py < 500) !== (y < 508)) { const t = (500 - py) / (y - py), cx = px + (x - px) * t; if (cx < gx || cx > gx + gap) return false; }
      px = x; py = y;
    }
    return true;
  };

  it('прохід 1 тайл: малий проходить, стандартний ні', () => {
    expect(wall(1, 1).route).not.toBeNull();
    expect(passes(wall(1, 1).route, 400, 1)).toBe(true);
    expect(wall(1, 2).route).toBeNull();
  });

  it('прохід 2 тайли: проходять обидва', () => {
    expect(wall(2, 1).route).not.toBeNull();
    const r2 = wall(2, 2).route;
    expect(r2).not.toBeNull();
    expect(passes(r2, 400, 2)).toBe(true);
  });
});

describe('згладжені шляхи по дорозі', () => {
  it('маршрут іде клітинками зі стежкою, а не однією прямою; детермінований', () => {
    const w = setup();
    const rt = getSectorRt(w, 0), S = SECTOR_CELLS, x0 = S / 2 - 30, y = S / 2 - 40, P = 4;
    rt.cellStage.fill(0);
    for (let x = x0; x <= x0 + 20; x++) rt.cellStage[(y + (x > x0 + 10 ? 3 : 0)) * S + x] = TrailStage.Paved;
    const args = [rt, 1, x0 * P + 2, y * P + 2, (x0 + 20) * P + 2, (y + 3) * P + 2] as const;
    const route = planRoute(...args);
    expect(route).not.toBeNull();
    expect(planRoute(...args)).toEqual(route);
    expect(route!.length / 2).toBeGreaterThanOrEqual(15);
  });
});
