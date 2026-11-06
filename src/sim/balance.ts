import type { BuildingKind, Profession, ResourceKind } from '../shared';

/** Баланс економіки (не впливає на формат сейва). */
export const NPC_CAPACITY = 4096;
export const NPC_SPEED = 0.25; // клітинок за тік на землі
export const CARRY_CAP = 3;
export const WORK_TICKS = 15; // добування одиниці
export const MILL_TICKS = 20; // 2 дерева -> 1 дошка
export const WAIT_TICKS = 15; // очікування при нестачі
export const WORK_RADIUS = 24;
export const ATTACHED_WORK_MULT = 0.8; // будівля на дорозі працює швидше
export const TREE_AMOUNT = 3;
export const STONE_AMOUNT = 8;
export const TREE_REGROW_INTERVAL = 100;
export const ROAD_CHECK_INTERVAL = 50;
export const HOUSE_SPAWN_INTERVAL = 200;
export const POP_BASE = 5;
export const POP_PER_HOUSE = 4;
export const START_SETTLERS = 5;
export const START_STOCK: Partial<Record<ResourceKind, number>> = { wood: 40, stone: 10, planks: 10 };

export const STORAGE_CAP: Partial<Record<BuildingKind, number>> = { townhall: 200, warehouse: 400 };
export const COSTS: Partial<Record<BuildingKind, Partial<Record<ResourceKind, number>>>> = {
  warehouse: { wood: 10 },
  lumberjack: { wood: 5 },
  quarry: { wood: 8 },
  sawmill: { wood: 10, stone: 5 },
  house: { planks: 5 },
};
export const MAX_WORKERS: Partial<Record<BuildingKind, number>> = { lumberjack: 8, quarry: 8, sawmill: 4 };
export const JOB_OF: Partial<Record<BuildingKind, Profession>> = {
  lumberjack: 'lumberjack', quarry: 'miner', sawmill: 'sawyer',
};
