/**
 * Інтерполяція позицій між двома станами (попередній тік -> поточний) за часткою тіка alpha ∈ [0,1].
 * Рендер малює кожен кадр, а сим іде 10 Гц: без цього NPC «стрибають» з тіка на тік.
 * Телепорт/поява (стрибок більший за maxJump) не інтерполюється: інакше NPC «проїде» через усю карту.
 */
export const INTERP_MAX_JUMP = 4; // тайлів за тік (макс. швидкість ≈ 1.15 тайла/тік)

export function lerpPos(prev: number, cur: number, alpha: number, maxJump = INTERP_MAX_JUMP): number {
  if (Math.abs(cur - prev) > maxJump) return cur;
  const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  return prev + (cur - prev) * a;
}

/** Таймер тіків: скільки пройшло від останнього тіка в частках його тривалості (адаптується до швидкості гри). */
export class TickClock {
  private last = 0;
  private dur = 100;
  /** Викликати одразу після кожного кроку симуляції. */
  tick(now: number): void {
    if (this.last) {
      const d = now - this.last;
      // кілька кроків за раз (швидка гра) дають d≈0: не звужуємо тривалість до нуля
      if (d >= 4) this.dur = Math.min(1000, this.dur * 0.7 + d * 0.3);
    }
    this.last = now;
  }
  alpha(now: number): number {
    if (!this.last) return 1;
    return Math.min(1, Math.max(0, (now - this.last) / this.dur));
  }
}
