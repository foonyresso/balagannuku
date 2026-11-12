/** Базові типи та ідентифікатори. Усі ID — числа/рядки, що просто серіалізуються. */

export type PlayerId = string; // стабільний id гравця в сейві
export type SectorId = number; // індекс сектора в GameState.sectors
export type BuildingId = number;
export type NpcId = number; // індекс у SoA-масивах NPC (стабільний, див. NpcStore.alive)
export type Tick = number;
export type ItemId = number; // 0 = порожньо; id у таблиці ITEMS
export type WallId = number;
export type MonsterId = number;
export type PoiId = number;

/** Осьові координати гекс-сектора (pointy-top), q — колонка, r — рядок. */
export interface HexCoord {
  q: number;
  r: number;
}

/** Координата ТАЙЛА всередині сектора (0..SECTOR_SIZE-1). */
export interface CellCoord {
  x: number;
  y: number;
}

/** Порядок = індекс у сейві (carryKind): нові види лише в кінець. gold у `PlayerState.resources` — це казна міста. */
export type ResourceKind =
  | 'wood' | 'stone' | 'ore' | 'water' | 'food' | 'planks' | 'gold'
  | 'ingot' | 'wheat' | 'herbs' | 'hide' | 'bread' | 'potion';
export const RESOURCE_KINDS: readonly ResourceKind[] = [
  'wood', 'stone', 'ore', 'water', 'food', 'planks', 'gold',
  'ingot', 'wheat', 'herbs', 'hide', 'bread', 'potion',
];

/** Нові види лише в кінець. Стіни, ворота й вежі живуть окремо (`WallKind`, `WallState`). */
export type BuildingKind =
  | 'townhall' | 'lumberjack' | 'warehouse' | 'house' | 'forge' | 'dungeon_gate' | 'quarry' | 'sawmill' | 'farm' | 'hunter' | 'fisher'
  | 'builders_hut' | 'smelter' | 'kitchen' | 'alchemy' | 'alch_farm' | 'pawnshop' | 'archery_range';
/** Нові професії лише в кінець (у сейві індекс). Бойовий клас (меч, лук, маг) — окреме поле `NpcStore.klass`. */
export type Profession =
  | 'idle' | 'lumberjack' | 'miner' | 'carrier' | 'smith' | 'hero' | 'sawyer' | 'farmer' | 'hunter' | 'fisher'
  | 'builder' | 'smelter' | 'cook' | 'alchemist' | 'alch_farmer';

/** Масив фіксованого типу у серіалізованому вигляді (base64 сирих байтів, little-endian). */
export interface PackedArray {
  type: 'u8' | 'u16' | 'i32' | 'u32' | 'f32';
  length: number;
  base64: string;
}
