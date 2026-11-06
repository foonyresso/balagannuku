import { describe, expect, it } from 'vitest';
import { lerpPos, TickClock } from './interp';

describe('інтерполяція NPC', () => {
  it('середина, клемп alpha', () => {
    expect(lerpPos(10, 11, 0.5)).toBeCloseTo(10.5);
    expect(lerpPos(10, 11, -1)).toBe(10);
    expect(lerpPos(10, 11, 5)).toBe(11);
  });
  it('телепорт/поява не прослизає', () => {
    expect(lerpPos(0, 500, 0.3)).toBe(500);
  });
  it('годинник тіка: alpha росте, а на паузі не перевищує 1', () => {
    const c = new TickClock();
    c.tick(1000); c.tick(1100);
    expect(c.alpha(1150)).toBeCloseTo(0.5, 1);
    expect(c.alpha(9000)).toBe(1);
  });
});
