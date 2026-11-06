import { SECTOR_SIZE, TRAIL_DECAY_FACTOR, TRAIL_MAX, TRAIL_STEP_ADD } from './constants';
import type { PackedArray } from './ids';

/**
 * Шар «стежок»: емерджентні дороги.
 * Кожен сектор має лічильник трафіку на тайл (u16, SECTOR_SIZE²).
 * - NPC, що пройшов клітинку, додає TRAIL_STEP_ADD.
 * - Раз на TRAIL_DECAY_INTERVAL тіків усе множиться на TRAIL_DECAY_FACTOR (згасання).
 * - Стадія — ПОХІДНА від трафіку за порогами; у сейві зберігається лише трафік.
 * Гістерезис: перехід вниз на нижчу стадію — при трафіку < поріг * HYSTERESIS,
 * щоб стадії не мерехтіли на межі.
 */
export enum TrailStage {
  None = 0,
  Trampled = 1, // витоптана стежка
  Road = 2, // дорога
  Paved = 3, // вимощена
}

export interface TrailThresholds {
  trampled: number;
  road: number;
  paved: number;
}

/**
 * Пороги на ТАЙЛ: геометрична прогресія ×8 — кожна наступна стадія набирається набагато важче.
 * Один прохід (+1) нічого не дає: потрібно ≥ trampled проходів, поки слід не встиг згаснути.
 */
export const DEFAULT_TRAIL_THRESHOLDS: TrailThresholds = { trampled: 8, road: 64, paved: 512 };
/** Ширина «пензля» стежки в тайлах за стадією (для рендера й прикріплення). */
export const TRAIL_BRUSH_TILES = [0, 1, 3, 5] as const;
export const TRAIL_HYSTERESIS = 0.8;

export function stageFromTraffic(
  traffic: number,
  prev: TrailStage = TrailStage.None,
  t: TrailThresholds = DEFAULT_TRAIL_THRESHOLDS,
): TrailStage {
  const lim = [0, t.trampled, t.road, t.paved];
  let s = TrailStage.None;
  for (let i = 1; i <= 3; i++) {
    const need = i <= prev ? lim[i] * TRAIL_HYSTERESIS : lim[i];
    if (traffic >= need) s = i as TrailStage;
  }
  return s;
}

/** Робочий (не серіалізований) вигляд шару одного сектора. */
export interface TrailLayer {
  traffic: Uint16Array; // SECTOR_SIZE*SECTOR_SIZE
}

export function createTrailLayer(): TrailLayer {
  return { traffic: new Uint16Array(SECTOR_SIZE * SECTOR_SIZE) };
}

export function addTraffic(layer: TrailLayer, x: number, y: number): void {
  const i = y * SECTOR_SIZE + x;
  layer.traffic[i] = Math.min(TRAIL_MAX, layer.traffic[i] + TRAIL_STEP_ADD);
}

export function decayTrails(layer: TrailLayer): void {
  const a = layer.traffic;
  for (let i = 0; i < a.length; i++) if (a[i]) a[i] = Math.floor(a[i] * TRAIL_DECAY_FACTOR);
}

/** Серіалізований вигляд (у SectorState). */
export type PackedTrailLayer = PackedArray & { type: 'u16' };

/**
 * Прикріплення будівель до дороги.
 * Будівля має «вхід» (клітинка). Якщо клітинка входу або сусідня має стадію ≥ Road,
 * будівля вважається прикріпленою (BuildingState.roadAttached — кеш, перераховується симуляцією).
 * Прикріплена будівля отримує бонус (швидкість NPC на дорозі +10…15%) — баланс у sim.
 * Дорога на 3-й стадії може стати «об'єктом» (спрайт-тайл/сегмент) — це чисто візуально/рендер,
 * симуляція оперує лише трафіком і стадією.
 */
export const ROAD_SPEED_MULT: Record<TrailStage, number> = {
  [TrailStage.None]: 1,
  [TrailStage.Trampled]: 1.1,
  [TrailStage.Road]: 1.125,
  [TrailStage.Paved]: 1.15,
};
export const ROAD_ATTACH_MIN_STAGE = TrailStage.Road;
