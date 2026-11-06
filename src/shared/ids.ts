/** Базові типи та ідентифікатори. Усі ID — числа/рядки, що просто серіалізуються. */

export type PlayerId = string; // стабільний id гравця в сейві
export type SectorId = number; // індекс сектора в GameState.sectors
export type BuildingId = number;
export type NpcId = number; // індекс у SoA-масивах NPC (стабільний, див. NpcStore.alive)
export type Tick = number;

/** Осьові координати гекс-сектора (pointy-top), q — колонка, r — рядок. */
export interface HexCoord {
  q: number;
  r: number;
}

/** Координата клітинки всередині сектора (0..SECTOR_SIZE-1). */
export interface CellCoord {
  x: number;
  y: number;
}

export type ResourceKind = 'wood' | 'stone' | 'ore' | 'water' | 'food' | 'planks' | 'gold';
export const RESOURCE_KINDS: readonly ResourceKind[] = [
  'wood', 'stone', 'ore', 'water', 'food', 'planks', 'gold',
];

export type BuildingKind = 'townhall' | 'lumberjack' | 'warehouse' | 'house' | 'forge' | 'dungeon_gate' | 'quarry' | 'sawmill';
export type Profession = 'idle' | 'lumberjack' | 'miner' | 'carrier' | 'smith' | 'hero' | 'sawyer';

/** Масив фіксованого типу у серіалізованому вигляді (base64 сирих байтів, little-endian). */
export interface PackedArray {
  type: 'u8' | 'u16' | 'i32' | 'u32' | 'f32';
  length: number;
  base64: string;
}
