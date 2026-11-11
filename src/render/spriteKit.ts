/**
 * Дані спрайтів (без Pixi, тестуються окремо). Атлас src/assets/atlas.png зібрано scripts/build-atlas.py:
 * плитки 16×16 з Kenney Tiny Town (індекс n) і Tiny Dungeon (індекс TD + n). Обидва паки CC0, див. CREDITS.md.
 */
import type { BuildingKind, Profession } from '../shared';

export const ATLAS_COLS = 16;
export const TILE_PX = 16;
/** Кількість плиток у кожному паку; Tiny Dungeon у атласі іде після Tiny Town. */
export const PACK_SIZE = 132;
export const TD = PACK_SIZE;
export const ATLAS_TILES = PACK_SIZE * 2;

/** Сітка плиток будівлі (-1 = порожньо). Фронтальний вигляд «дах + стіна», як у платформерів. */
export const BUILDING_GRID: Record<BuildingKind, number[][]> = {
  townhall: [[48, 49, 49, 49, 49, 50], [60, 61, 61, 61, 61, 62], [76, 88, 89, 90, 88, 78], [76, 77, 77, 77, 77, 78]],
  warehouse: [[52, 53, 53, 54], [64, 65, 65, 66], [72, 74, 74, 75]],
  lumberjack: [[52, 53, 54, -1], [64, 65, 66, -1], [72, 85, 73, 106]],
  quarry: [[-1, 126, 126, -1], [43, 126, 115, 43]],
  sawmill: [[52, 53, 53, 54], [64, 65, 65, 66], [73, 74, 57, 106]],
  farm: [[44, 45, 45, 46], [47, 17, 17, 47], [80, 81, 81, 82]],
  hunter: [[52, 53, 54, -1], [64, 65, 66, -1], [72, 85, 95, 118]],
  fisher: [[52, 53, 54, -1], [64, 65, 66, -1], [72, 85, 131, -1]],
  house: [[52, 53, 54], [64, 65, 66], [84, 85, 84]],
  forge: [[48, 49, 50, -1], [60, 61, 62, -1], [76, 89, 115, 105]],
  dungeon_gate: [[96, 97, 97, 98], [111, 112, 112, 113], [76, 77, 77, 78]],
};

/** Варіанти дерев (зелені й осінні), вибираються за вузлом. */
export const TREE_TILES_PX = [4, 16, 28, 5, 3, 15, 27];

/** Житель: тіло (Tiny Dungeon) + предмет у руці + щит. Клас видно за спорядженням. */
export interface NpcKit { body: number; item?: number; shield?: number }
export const NPC_KIT: Record<Profession, NpcKit> = {
  idle: { body: TD + 85 },
  lumberjack: { body: TD + 86, item: TD + 118 },
  miner: { body: TD + 88, item: 115 },
  carrier: { body: TD + 87 },
  smith: { body: TD + 98, item: TD + 117 },
  hero: { body: TD + 96, item: TD + 106, shield: TD + 101 },
  sawyer: { body: TD + 100, item: TD + 119 },
  farmer: { body: TD + 99, item: 116 },
  hunter: { body: TD + 112, item: 118 },
  fisher: { body: TD + 111, item: TD + 131 },
};

export const atlasRect = (n: number): { x: number; y: number } => ({ x: (n % ATLAS_COLS) * TILE_PX, y: Math.floor(n / ATLAS_COLS) * TILE_PX });
