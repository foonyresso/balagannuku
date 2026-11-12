import type { Application, Container, Sprite } from 'pixi.js';
import type { BuildingKind } from '../../shared';
import { SECTOR_CELLS, SECTOR_SIZE } from '../../shared';
import type { SimWorld, getSectorRt } from '../../sim';
import type { CityHud } from '../../ui/cityHud';
import type { Sel } from '../../ui/info';
import type { TickClock } from '../interp';
import { planeToIso, type Camera, type Vec2 } from '../projection';
import type { Atmosphere, Particles } from '../style';

/** Спільне для всіх частин вигляду міста: константи, типи, стан сцени й керування. Логіки тут немає. */

/** Розмір ТАЙЛА в одиницях площини (та сама проєкція, що й у карти): сектор = SECTOR_SIZE тайлів. */
export const TILE = 4;
/** У місті можна наблизитись упритул до одного жителя. */
export const CITY_ZOOM_MAX = 10;
export const FOLLOW_ZOOM = 3.5;
// Шар глибини = один ряд клітинок (BUCKET = TILES_PER_CELL тайлів): вузол клітинки cy завжди лягає в шар cy,
// тож зміну вузлів у рядку можна перемалювати одним шаром.
export const NB = SECTOR_CELLS;
export const BUCKET = SECTOR_SIZE / NB;
/** Шар глибини для тайла з координатою y. */
export const rowOf = (ty: number): number => Math.min(NB - 1, Math.max(0, Math.floor(ty / BUCKET)));

export type Tile = { x: number; y: number };
export type Rt = ReturnType<typeof getSectorRt>;
/** Статичний об'єкт шару глибини: спрайти (дерево, камінь, споруда) + полігон влучання й виділення. */
export interface Obj { sprites: Sprite[]; pick: number[] | null; tile: Tile | null; sel: Sel | null }

/** Сцена: те, що бачать усі частини. `cam` і `rows` замінюються цілком, тому читай їх зі сцени щоразу. */
export interface Scene {
  readonly app: Application;
  readonly w: SimWorld;
  readonly player: string;
  readonly sector: number;
  /** Корінь світу: рухається й масштабується камерою. */
  readonly root: Container;
  /** Шар глибини = ряд клітинок; у ньому дерева, споруди й жителі, відсортовані за zIndex (= y площини). */
  readonly rowCont: Container[];
  /** Об'єкти шарів глибини (для влучання курсором). */
  rows: Obj[][];
  cam: Camera;
  readonly atmo: Atmosphere;
  readonly parts: Particles;
  readonly clock: TickClock;
  /** Час анімацій, с (стоїть на паузі). */
  animT: number;
}

/** Стан керування (що вибрано, куди дивиться камера, швидкість гри). */
export interface Ui {
  /** Режим будівництва: вибрана будівля; null = режим «вибір» (курсор порожній). Після однієї споруди повертається в null. */
  build: BuildingKind | null;
  sel: Sel | null;
  hoverSel: Sel | null;
  hover: Tile | null;
  following: boolean;
  targetZoom: number;
  speed: number;
  resumeSpeed: number;
}

/** Те, що частини (ввід, дії гравця) викликають у CityView. */
export interface CityApi {
  readonly scene: Scene;
  readonly ui: Ui;
  readonly hud: CityHud;
  setBuild(k: BuildingKind | null): void;
  select(sel: Sel, follow: boolean): void;
  deselect(): void;
  setFollow(on: boolean): void;
  refreshHud(): void;
  userSpeed(v: number): void;
  /** Перебудувати шари об'єктів (після будівництва чи знесення); roads — ще й перемалювати дороги. */
  rebuild(roads?: boolean): void;
  exit(): void;
}

/** Прямокутник у тайлах -> ізо-полігон (на висоті z). */
export function quad(tx: number, ty: number, tw: number, th: number, z = 0): number[] {
  const x = tx * TILE, y = ty * TILE, w = tw * TILE, h = th * TILE;
  return [planeToIso(x, y, z), planeToIso(x + w, y, z), planeToIso(x + w, y + h, z), planeToIso(x, y + h, z)].flatMap((v: Vec2) => [v.x, v.y]);
}
