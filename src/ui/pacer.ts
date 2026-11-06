/** Допустимі швидкості гри (0 = пауза). */
export const SPEEDS = [0, 1, 2, 5, 10, 100] as const;
export type Speed = (typeof SPEEDS)[number];
export const isSpeed = (v: unknown): v is Speed => SPEEDS.includes(v as Speed);

const BASE_TICK_MS = 100; // 10 тіків/с на швидкості 1×

/**
 * Прив'язує тіки симуляції до кадрів: на швидкості N за кадр треба N·dt/100 тіків.
 * Тіки виконуються, поки не вичерпано бюджет часу кадру (щоб 100× не вішало вкладку);
 * чого не встигли — відкидаємо, і `actual` показує фактичну швидкість (у кратності до 1×).
 */
export class TickPacer {
  private acc = 0;
  /** Фактична швидкість (згладжена), у кратності до 1×. */
  actual = 0;

  constructor(private now: () => number = () => performance.now()) {}

  /** Повертає кількість виконаних тіків. dtMs обмежений (згорнута вкладка не дає лавини тіків). */
  advance(dtMs: number, speed: number, runTick: () => void, budgetMs = 12): number {
    if (speed <= 0) { this.acc = 0; this.actual = 0; return 0; }
    const dt = Math.min(Math.max(dtMs, 0), 250);
    this.acc += (dt / BASE_TICK_MS) * speed;
    const t0 = this.now();
    let n = 0;
    while (this.acc >= 1) {
      if (n > 0 && this.now() - t0 >= budgetMs) break;
      runTick(); this.acc -= 1; n++;
    }
    if (this.acc >= 1) this.acc = 0; // не встигли: відкидаємо борг
    const inst = dt > 0 ? (n * BASE_TICK_MS) / dt : speed;
    this.actual = this.actual === 0 ? inst : this.actual * 0.8 + inst * 0.2;
    return n;
  }
}
