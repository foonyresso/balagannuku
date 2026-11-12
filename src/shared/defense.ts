/**
 * Контракти оборони й темного світу: стіни, вежі, монстри, точки інтересу (POI).
 * Лише форми стану. Поведінка, числа й генерація приходять у етапах 5–8 (`docs/DESIGN-dark-world.md`).
 * Усі координати монстрів і POI — у тайлах сектора, стіни — у клітинках навігації (TILES_PER_CELL тайлів).
 */
import type { CellCoord, ItemId, MonsterId, NpcId, PlayerId, PoiId, ResourceKind, SectorId, WallId } from './ids';

/** Порядок = індекс у сейві, нові види лише в кінець. Стіна й ворота — 1 клітинка, вежа — 2×2 клітинки. */
export const WALL_KINDS = ['wall_wood', 'wall_stone', 'gate_main', 'tower'] as const;
export type WallKind = (typeof WALL_KINDS)[number];
/** Вежа: скільки лучників. */
export const TOWER_GARRISON_SLOTS = 3;

/** Сегмент стіни, ворота або вежа. Фундамент = `progress` < 1 (HP 20%, не світить), стадії вигляду виводяться з `progress`. */
export interface WallState {
  id: WallId;
  kind: WallKind;
  owner: PlayerId;
  sector: SectorId;
  cell: CellCoord; // лівий верхній КЛІТИНКА навігації
  hp: number;
  progress: number; // 0..1 будівництво
  builder: NpcId; // -1 = ніхто
  /** Лучники вежі (лише tower), довжина ≤ TOWER_GARRISON_SLOTS. */
  garrison?: NpcId[];
}

/** Порядок = індекс у сейві, нові лише в кінець. Виплодок, хижак, броненосець, стрілець, таран, еліта. */
export const MONSTER_KINDS = ['brood', 'stalker', 'armadillo', 'spitter', 'ram', 'elite'] as const;
export type MonsterKind = (typeof MONSTER_KINDS)[number];

export interface MonsterState {
  id: MonsterId;
  kind: MonsterKind;
  sector: SectorId;
  x: number;
  y: number;
  hp: number;
  /** Номер ночі, що породила монстра (множник сили); 0 = денний мандрівник. */
  night: number;
  /** Рівень (денні росте з відстанню від міста). */
  level: number;
  /** Портал-джерело, -1 = з темряви. */
  home: PoiId;
}

/** Приховані об'єкти: видно лише в освітленій зоні, знайдені лишаються мітками. */
export const POI_KINDS = ['chest', 'loot_bag', 'portal', 'rare_node', 'monster_camp'] as const;
export type PoiKind = (typeof POI_KINDS)[number];

export interface PoiLoot {
  gold: number;
  items: ItemId[];
  resources: Partial<Record<ResourceKind, number>>;
}

export interface PoiState {
  id: PoiId;
  kind: PoiKind;
  sector: SectorId;
  x: number;
  y: number;
  /** Відкрита скриня, підібраний мішок, знищений портал: об'єкт лишається записом до очищення. */
  done: boolean;
  /** Лише portal: поточні HP. */
  hp?: number;
  loot?: PoiLoot;
  /** Лише rare_node: який ресурс дає. */
  rare?: ResourceKind;
}
