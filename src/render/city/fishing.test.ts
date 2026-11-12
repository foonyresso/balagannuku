import { describe, expect, it } from 'vitest';
import { bobberAt, nearestWater } from './fishing';
import { actFrames, hitFrame, rodTip } from '../style/characters';

describe('fishing view', () => {
  const water = (x: number, _y: number) => x >= 10;
  it('знаходить найближчу воду і ставить поплавок на воді', () => {
    const w = nearestWater(water, 8.5, 5.5)!;
    expect(w.x).toBe(10.5);
    const b = bobberAt({ x: 8.5, y: 5.5 }, w, 0);
    expect(b.x).toBeGreaterThanOrEqual(10);
  });
  it('без води поруч — null', () => { expect(nearestWater(() => false, 5, 5)).toBeNull(); });
  it('поплавок не під ногами', () => {
    const b = bobberAt({ x: 9.9, y: 5.5 }, { x: 10.5, y: 5.5 }, 0);
    expect(b.x - 9.9).toBeGreaterThanOrEqual(1.4);
  });
  it('цикл вудки має кадр кидка і підсікання', () => { expect(actFrames('rod')).toBe(8); expect(hitFrame('rod')).toBe(3); expect(rodTip(40).x).toBeGreaterThan(5); });
});
