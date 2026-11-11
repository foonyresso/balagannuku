import type { ResourceKind } from './ids';

/**
 * Дика фауна. Звірі живуть у GameState.fauna (детермінована симуляція, потрапляють у сейв).
 * Мʼясо = ресурс `food`: ним годуються жителі, а в майбутньому й NPC-герої (їм потрібна їжа).
 */
export type AnimalKind = 'rabbit' | 'hare' | 'fox' | 'deer' | 'wolf' | 'bear';
export const ANIMAL_KINDS: readonly AnimalKind[] = ['rabbit', 'hare', 'fox', 'deer', 'wolf', 'bear'];
/** Що дає здобич. */
export const MEAT_RESOURCE: ResourceKind = 'food';

export interface AnimalSpec {
  /** Одиниць мʼяса (їжі) з однієї тушки. */
  meat: number;
  /** Швидкість блукання / втечі, тайлів за тік. */
  speed: number;
  fleeSpeed: number;
  /** Відстань (тайлів) до мисливця, з якої звір тікає (0 = не тікає). */
  fleeRadius: number;
  /** Чи полює на нього мисливець зараз. Вовки й ведмеді небезпечні: поки лише живуть у лісі. */
  huntable: boolean;
  /** Агресивний (на майбутнє: нападатиме на жителів і мисливців). */
  aggressive: boolean;
  /** Цільова популяція на місто. */
  target: number;
  /** Найближча відстань появи від ратуші, тайлів. */
  spawnMin: number;
}

export const ANIMALS: Record<AnimalKind, AnimalSpec> = {
  rabbit: { meat: 1, speed: 0.22, fleeSpeed: 0.9, fleeRadius: 14, huntable: true, aggressive: false, target: 12, spawnMin: 36 },
  hare: { meat: 1, speed: 0.25, fleeSpeed: 1.1, fleeRadius: 16, huntable: true, aggressive: false, target: 8, spawnMin: 40 },
  fox: { meat: 2, speed: 0.3, fleeSpeed: 1, fleeRadius: 14, huntable: true, aggressive: false, target: 5, spawnMin: 45 },
  deer: { meat: 4, speed: 0.28, fleeSpeed: 1.05, fleeRadius: 18, huntable: true, aggressive: false, target: 8, spawnMin: 50 },
  wolf: { meat: 3, speed: 0.35, fleeSpeed: 0.35, fleeRadius: 0, huntable: false, aggressive: true, target: 3, spawnMin: 110 },
  bear: { meat: 6, speed: 0.25, fleeSpeed: 0.25, fleeRadius: 0, huntable: false, aggressive: true, target: 2, spawnMin: 120 },
};

/** Режими звіра. */
export const ANIMAL_MODE = { idle: 0, wander: 1, flee: 2, dead: 3 } as const;

export interface AnimalState {
  id: number;
  kind: AnimalKind;
  sector: number;
  x: number; y: number; // тайли (дробові)
  px: number; py: number; // позиція на початку тіка (інтерполяція в рендері)
  mode: number; // ANIMAL_MODE
  tx: number; ty: number; // ціль блукання
  timer: number; // тіків до зміни режиму; для мертвого — до зникнення
  /** Мисливець, що переслідує (npc id + 1), 0 = ніхто. */
  by: number;
}

export interface FaunaState {
  animals: AnimalState[];
  nextId: number;
}

export const createFauna = (): FaunaState => ({ animals: [], nextId: 1 });
