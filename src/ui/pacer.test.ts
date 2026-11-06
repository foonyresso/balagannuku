import { describe, expect, it } from 'vitest';
import { TickPacer } from './pacer';

describe('TickPacer', () => {
  it('N× дає N·dt/100 тіків за кадр', () => {
    for (const [speed, ticks] of [[1, 1], [2, 2], [5, 5], [10, 10], [100, 100]] as const) {
      const p = new TickPacer(() => 0); let n = 0;
      p.advance(100, speed, () => n++, 1e9);
      expect(n).toBe(ticks);
    }
  });
  it('дробові залишки накопичуються між кадрами', () => {
    const p = new TickPacer(() => 0); let n = 0;
    for (let i = 0; i < 10; i++) p.advance(16, 1, () => n++);
    expect(n).toBe(1); // 160 мс = 1.6 тіка
    for (let i = 0; i < 10; i++) p.advance(16, 1, () => n++);
    expect(n).toBe(3); // 320 мс
  });
  it('пауза не виконує тіків і скидає накопичене', () => {
    const p = new TickPacer(() => 0); let n = 0;
    p.advance(50, 1, () => n++); p.advance(100, 0, () => n++);
    p.advance(50, 1, () => n++);
    expect(n).toBe(0);
  });
  it('бюджет часу кадру обмежує тіки, борг відкидається, actual менший за ціль', () => {
    let t = 0; const p = new TickPacer(() => t); let n = 0;
    for (let f = 0; f < 20; f++) p.advance(16, 100, () => { n++; t += 1; }, 12); // тік коштує 1 мс
    expect(n).toBeLessThanOrEqual(20 * 13);
    expect(n).toBeGreaterThan(20 * 5);
    expect(p.actual).toBeLessThan(100);
    expect(p.actual).toBeGreaterThan(0);
  });
  it('лавина dt (фонова вкладка) обрізається', () => {
    const p = new TickPacer(() => 0); let n = 0;
    p.advance(60000, 1, () => n++, 1e9);
    expect(n).toBe(2); // ≤ 250 мс -> 2 тіки
  });
});
