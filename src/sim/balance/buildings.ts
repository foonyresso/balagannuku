import type { BuildingKind, Profession, ResourceKind } from '../../shared';

/** Усе про один вид споруди. Розмір записується в `BuildingState.size`, тож зміни тут не ламають сейви. */
export interface BuildingDef {
  /** Footprint у тайлах (ширина × глибина). Вхід — по центру нижньої межі. */
  footprint: { w: number; h: number };
  /** Непрохідна частина footprint (відносно лівого верхнього тайла): решта — прохідне поле. Без запису — суцільний footprint. */
  solid?: { x: number; y: number; w: number; h: number };
  /** Ціна будівництва. Без запису споруду не будують (ратуша з'являється сама). */
  cost?: Partial<Record<ResourceKind, number>>;
  /** Слоти працівників. Продуктивність = частка зайнятих слотів (кожен працівник працює сам), окремої формули немає. */
  workers?: number;
  /** Типова кількість працівників. Без запису споруда заповнюється повністю. */
  defaultWorkers?: number;
  /** Професія працівників споруди. */
  job?: Profession;
  /** Місткість сховища (на вид ресурсу). */
  storage?: number;
}

/**
 * Таблиця споруд: один запис на вид. Нова споруда = новий запис тут
 * (порядок записів = порядок кнопок і реєстрації спрайтів, нові додавай у кінець).
 */
export const BUILDINGS: Partial<Record<BuildingKind, BuildingDef>> = {
  townhall: { footprint: { w: 20, h: 20 }, storage: 1e9 }, // ратуша (головний склад) безкінечна
  warehouse: { footprint: { w: 12, h: 12 }, cost: { wood: 10 }, workers: 4, defaultWorkers: 0, job: 'carrier', storage: 400 }, // підсклад має буфер, який носії розвантажують; носіїв додає гравець
  lumberjack: { footprint: { w: 8, h: 8 }, cost: { wood: 5 }, workers: 2, job: 'lumberjack' },
  quarry: { footprint: { w: 8, h: 8 }, cost: { wood: 8 }, workers: 4, job: 'miner' },
  sawmill: { footprint: { w: 10, h: 10 }, cost: { wood: 10, stone: 5 }, workers: 2, job: 'sawyer' },
  house: { footprint: { w: 6, h: 6 }, cost: { planks: 5 } },
  farm: { footprint: { w: 20, h: 20 }, solid: { x: 0, y: 0, w: 5, h: 5 }, cost: { wood: 10, planks: 2 }, workers: 3, job: 'farmer' }, // поле ≈ у 4 рази більше за площею; фермери працюють НА полі
  hunter: { footprint: { w: 8, h: 8 }, cost: { wood: 8 }, workers: 2, job: 'hunter' },
  fisher: { footprint: { w: 8, h: 8 }, cost: { wood: 8 }, workers: 2, job: 'fisher' },
};

/** Одне поле таблиці як окрема мапа «вид -> значення» (лише споруди, де поле задане). */
const column = <K extends keyof BuildingDef>(field: K): Partial<Record<BuildingKind, NonNullable<BuildingDef[K]>>> =>
  Object.fromEntries(Object.entries(BUILDINGS).filter(([, d]) => d[field] !== undefined).map(([k, d]) => [k, d[field]]));

/** Похідні від BUILDINGS (для зручного доступу за видом). Значення міняй у таблиці, а не тут. */
export const FOOTPRINT = column('footprint');
export const SOLID_RECT = column('solid');
export const COSTS = column('cost');
export const MAX_WORKERS = column('workers');
export const DEFAULT_WORKERS = column('defaultWorkers');
export const JOB_OF = column('job');
export const STORAGE_CAP = column('storage');

/** Скільки тайлів навколо footprint має бути вільним від вузлів ресурсів при будівництві. */
export const PLACE_MARGIN = 1;
