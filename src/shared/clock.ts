/**
 * Годинник дня й ночі: чиста функція від `tick + world.clockShift`. Без Date, без стану.
 * Таймінги тут, а не в `sim/balance/`, бо їх читають і render, і ui (shared не залежить від sim).
 * `clockShift` змінює лише адмін-панель (команда `admin`): справжній `tick` не стрибає.
 */
import type { Tick } from './ids';

export const DAY_TICKS = 6000; // 10 хв
export const NIGHT_TICKS = 4200; // 7 хв; останні TWILIGHT_TICKS ночі — світанок
export const CYCLE_TICKS = DAY_TICKS + NIGHT_TICKS; // 17 хв
export const FIRST_NIGHT_TICK = 9000; // перша ніч через 15 хв від старту
export const TWILIGHT_TICKS = 300; // 30 с плавного переходу (сутінки перед ніччю, світанок наприкінці)
export const NIGHT_WARNING_TICKS = 600; // застереження в HUD за 60 с до ночі

export type DayPhase = 'day' | 'dusk' | 'night' | 'dawn';

export interface ClockInfo {
  phase: DayPhase;
  /** Номер ночі: поточної (night, dawn) або найближчої (day, dusk). Починається з 1. */
  night: number;
  /** Освітленість 0..1: 1 день, 0 глибока ніч, лінійно на сутінках і світанку. */
  light: number;
  /** Тіків до початку найближчої ночі (0 під час night/dawn). */
  ticksToNight: number;
  /** Тіків до кінця ночі (0 удень). */
  ticksToDay: number;
}

/** Тік, з якого починається ніч n (n ≥ 1). */
export const nightStartTick = (n: number): Tick => FIRST_NIGHT_TICK + (n - 1) * CYCLE_TICKS;

/** Годинниковий тік з урахуванням зсуву; не менше 0. */
export const clockTick = (tick: Tick, clockShift: number): Tick => Math.max(0, tick + clockShift);

export function dayClock(tick: Tick, clockShift = 0): ClockInfo {
  const c = clockTick(tick, clockShift);
  let n = c < FIRST_NIGHT_TICK ? 1 : Math.floor((c - FIRST_NIGHT_TICK) / CYCLE_TICKS) + 1;
  if (c >= nightStartTick(n) + NIGHT_TICKS) n++;
  const start = nightStartTick(n);
  if (c >= start) {
    const into = c - start;
    const dawn = into >= NIGHT_TICKS - TWILIGHT_TICKS;
    return { phase: dawn ? 'dawn' : 'night', night: n, light: dawn ? (into - (NIGHT_TICKS - TWILIGHT_TICKS)) / TWILIGHT_TICKS : 0, ticksToNight: 0, ticksToDay: NIGHT_TICKS - into };
  }
  const toNight = start - c;
  const dusk = toNight <= TWILIGHT_TICKS;
  return { phase: dusk ? 'dusk' : 'day', night: n, light: dusk ? toNight / TWILIGHT_TICKS : 1, ticksToNight: toNight, ticksToDay: 0 };
}

/** Нове значення `clockShift`, при якому на цьому тіку одразу починається ніч n. */
export const shiftForNightStart = (tick: Tick, n: number): number => nightStartTick(n) - tick;

/**
 * Нове значення `clockShift` для «скіпнути день»: на початок сутінків найближчої ночі.
 * Уже сутінки: без змін. Ніч або світанок: сутінки наступної ночі.
 */
export function shiftToNextDusk(tick: Tick, clockShift: number): number {
  const info = dayClock(tick, clockShift);
  if (info.phase === 'dusk') return clockShift;
  const target = info.phase === 'day' ? info.night : info.night + 1;
  return nightStartTick(target) - TWILIGHT_TICKS - tick;
}
