import type {
  BuildingId, BuildingKind, CellCoord, HexCoord, NpcId, PackedArray, PlayerId,
  Profession, ResourceKind, SectorId, Tick,
} from './ids';
import type { PackedTrailLayer } from './trails';
import type { FlowLedger } from './flows';

/**
 * Увесь стан гри — ОДНЕ дерево GameState. Нічого не живе поза ним.
 * Симуляція = чиста функція (state, commands) -> state, детермінована (seed + tick).
 * Серіалізація: JSON; typed arrays пакуються у PackedArray.
 */
export interface GameState {
  tick: Tick;
  rngState: number; // стан детермінованого ГПВЧ
  world: WorldState;
  players: PlayerState[];
  sectors: SectorState[];
  buildings: BuildingState[]; // розріджений список; id унікальні
  nextBuildingId: BuildingId;
  npcs: NpcStore;
  /** Облік потоків ресурсів (виробництво/споживання/ребра) для візуалізатора ланцюжків. */
  flows: FlowLedger;
}

export interface WorldState {
  seed: number;
  radius: number; // радіус карти в секторах
  minStartDistance: number;
}

export interface PlayerState {
  id: PlayerId;
  nickname: string;
  /** Секретний токен для повернення у власне місто після «Продовжити». */
  token: string;
  color: number; // 0xRRGGBB
  homeSector: SectorId | null;
  ownedSectors: SectorId[];
  resources: Record<ResourceKind, number>;
}

export interface SectorState {
  id: SectorId;
  hex: HexCoord;
  owner: PlayerId | null;
  /** Багатство ресурсів 0..1 (з шуму, фіксується при генерації). */
  richness: Partial<Record<ResourceKind, number>>;
  /** Трафік стежок на тайл (SECTOR_SIZE², u16). Стадія — похідна. */
  trails: PackedTrailLayer | null;
  /** Залишок у вузлах ресурсів (дерево/камінь) на КЛІТИНКУ навігації (SECTOR_CELLS²); null = початковий. Вид вузла похідний від seed. */
  nodes: PackedArray | null;
}

export interface BuildingState {
  id: BuildingId;
  kind: BuildingKind;
  owner: PlayerId;
  sector: SectorId;
  cell: CellCoord; // лівий верхній тайл footprint
  size: { w: number; h: number }; // footprint у тайлах
  entrance: CellCoord; // тайл входу (для NPC і прикріплення до дороги)
  progress: number; // 0..1 будівництво
  roadAttached: boolean; // кеш, перераховує sim
  stock: Partial<Record<ResourceKind, number>>;
  workers: NpcId[];
  /** Бажана кількість працівників (плюс/мінус у UI). Немає = типове для виду. */
  workerCap?: number;
  /** Переробник на паузі (гравець зупинив): не бере й не приймає сировину. Необов'язкове поле. */
  paused?: boolean;
}

/**
 * NPC у вигляді SoA: паралельні масиви однакової довжини (capacity).
 * Слот вільний, якщо alive[i] == 0. Індекс = NpcId.
 */
export interface NpcStore {
  capacity: number;
  count: number;
  alive: Uint8Array;
  sector: Uint16Array;
  x: Float32Array; // у тайлах сектора (дробові; NPC рухаються вільно)
  y: Float32Array;
  profession: Uint8Array; // індекс у PROFESSIONS
  task: Uint8Array; // індекс у TASKS
  targetBuilding: Int32Array; // -1 = немає
  owner: Uint8Array; // індекс у players
  hp: Uint16Array;
  level: Uint8Array;
  /** Інвентар/спорядження: слоти фіксованої ширини. 0 = порожньо. */
  inventory: Uint16Array; // capacity * INVENTORY_SLOTS (id предмета)
  equipment: Uint16Array; // capacity * EQUIPMENT_SLOTS
  carryKind: Uint8Array; // що несе (індекс RESOURCE_KINDS, 255 = нічого)
  carryAmount: Uint8Array;
  /** Ім'я: індекс у таблиці імен (npcName). */
  nameId: Uint16Array;
  /** Стати: capacity * NPC_STAT_COUNT, у відсотках (див. NPC_STATS). */
  stats: Uint8Array;
  /** Маска перків (PERKS). */
  perks: Uint16Array;
  /** Ситість 0..100 (0 = голодує: не працює). Спадає з часом, відновлюється їжею зі складу. */
  fullness: Uint8Array;
}

export const INVENTORY_SLOTS = 8;
export const EQUIPMENT_SLOTS = 4; // голова, тіло, зброя, щит
export const PROFESSIONS: readonly Profession[] = ['idle', 'lumberjack', 'miner', 'carrier', 'smith', 'hero', 'sawyer', 'farmer', 'hunter', 'fisher'];
export const TASKS = ['idle', 'walk', 'work', 'carry', 'rest', 'dungeon'] as const;

/** Серіалізований NpcStore: кожен typed array -> PackedArray. */
export type PackedNpcStore = { capacity: number; count: number } & {
  [K in Exclude<keyof NpcStore, 'capacity' | 'count'>]: PackedArray;
};

/** Серіалізований GameState (те, що лежить у сейві та йде в знімках). */
export type SerializedGameState = Omit<GameState, 'npcs'> & { npcs: PackedNpcStore };
