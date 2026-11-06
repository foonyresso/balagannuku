/**
 * Єдина ізометрична (2:1-диметрична) проєкція гри. Камера НЕ обертається: лише пан і зум.
 *
 * Системи координат:
 *  - плоска карта (plane): x, y у «піксельних» одиницях гекс-сітки (hexToPixel), z — висота над землею;
 *  - екран (screen): пікселі вікна.
 * Усі перетворення живуть ТІЛЬКИ тут, щоб карта, будівлі, NPC й підказки не розходились.
 */
import type { HexCoord } from '../shared';
import { hexToPixel, pixelToHex } from '../sim/hex';

export const HEX_SIZE = 40;
/**
 * Кут огляду над горизонтом, градуси: 90 = строго зверху, 30 ≈ класичне 2:1, 40–45 = «ізометрія» для цієї гри.
 * Єдине місце, де його змінюють.
 */
export const VIEW_ANGLE_DEG = 42;
const RAD = (VIEW_ANGLE_DEG * Math.PI) / 180;
/** Стиснення осі Y плитки: sin(кута). */
export const ISO_Y = Math.sin(RAD);
/** Масштаб висоти (вертикалі): cos(кута). */
export const ISO_Z = Math.cos(RAD);
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 3;

export interface Camera {
  /** Зсув у екранних пікселях (куди потрапляє початок світу). */
  x: number;
  y: number;
  zoom: number;
}

export interface Vec2 { x: number; y: number }

/** plane (+висота) -> «світові» ізо-координати (до камери). */
export function planeToIso(x: number, y: number, z = 0): Vec2 {
  return { x, y: y * ISO_Y - z * ISO_Z };
}

/** «Світові» ізо-координати (z = 0) -> plane. */
export function isoToPlane(x: number, y: number): Vec2 {
  return { x, y: y / ISO_Y };
}

export function isoToScreen(p: Vec2, cam: Camera): Vec2 {
  return { x: p.x * cam.zoom + cam.x, y: p.y * cam.zoom + cam.y };
}

export function screenToIso(sx: number, sy: number, cam: Camera): Vec2 {
  return { x: (sx - cam.x) / cam.zoom, y: (sy - cam.y) / cam.zoom };
}

/** Екран -> plane (на рівні землі, z = 0). */
export function screenToPlane(sx: number, sy: number, cam: Camera): Vec2 {
  const i = screenToIso(sx, sy, cam);
  return isoToPlane(i.x, i.y);
}

/** Екран -> гекс-сектор (за землею; висота тайлів у пікінг не входить). */
export function screenToHex(sx: number, sy: number, cam: Camera): HexCoord {
  const p = screenToPlane(sx, sy, cam);
  return pixelToHex(p.x, p.y, HEX_SIZE);
}

/** Центр гекса в ізо-координатах (з висотою z). */
export function hexToIso(h: HexCoord, z = 0): Vec2 {
  const p = hexToPixel(h, HEX_SIZE);
  return planeToIso(p.x, p.y, z);
}

/** Зум навколо точки екрана (точка під курсором лишається на місці). */
export function zoomAt(cam: Camera, sx: number, sy: number, factor: number): Camera {
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, cam.zoom * factor));
  return {
    zoom,
    x: sx - ((sx - cam.x) / cam.zoom) * zoom,
    y: sy - ((sy - cam.y) / cam.zoom) * zoom,
  };
}

/** Порядок малювання «ззаду наперед»: більший ізо-y — ближче до глядача. */
export function depthOrder(a: HexCoord, b: HexCoord): number {
  const pa = hexToPixel(a, HEX_SIZE), pb = hexToPixel(b, HEX_SIZE);
  return pa.y - pb.y || pa.x - pb.x;
}

/** Геометрія плитки (ізо-координати). Єдине джерело і для малювання, і для пікінгу. */
const TILE_R = HEX_SIZE - 1.5;
export const TILE_CORNERS: readonly Vec2[] = Array.from({ length: 6 }, (_, i) => {
  const a = (Math.PI / 180) * (60 * i - 30);
  return { x: Math.cos(a) * TILE_R, y: Math.sin(a) * TILE_R };
});

export interface TileGeometry {
  /** Верхня грань: [x0,y0,x1,y1,...]. */
  top: number[];
  /** Дві передні бічні стінки з коефіцієнтом затінення. */
  walls: { poly: number[]; shade: number }[];
}

export function tileGeometry(h: HexCoord, height: number): TileGeometry {
  const c = hexToPixel(h, HEX_SIZE);
  const P = (i: number, z: number) => planeToIso(c.x + TILE_CORNERS[i].x, c.y + TILE_CORNERS[i].y, z);
  const top: number[] = [];
  for (let i = 0; i < 6; i++) { const p = P(i, height); top.push(p.x, p.y); }
  const wall = (i: number, j: number, shade: number) => {
    const a0 = P(i, height), a1 = P(j, height), b0 = P(i, 0), b1 = P(j, 0);
    return { poly: [a0.x, a0.y, a1.x, a1.y, b1.x, b1.y, b0.x, b0.y], shade };
  };
  return { top, walls: [wall(1, 2, 0.6), wall(2, 3, 0.75)] };
}

export function pointInPoly(x: number, y: number, poly: readonly number[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export interface PickTile { id: number; hex: HexCoord; height: number }

/**
 * Пікінг у порядку малювання: перебираємо плитки від найближчої до глядача й беремо першу,
 * в яку влучає точка (верхня грань або бічна стінка). Так обирається те, що видно на екрані.
 */
export function pickTile(tiles: readonly PickTile[], sx: number, sy: number, cam: Camera): number | null {
  const p = screenToIso(sx, sy, cam);
  const front = [...tiles].sort((a, b) => depthOrder(b.hex, a.hex));
  for (const t of front) {
    const g = tileGeometry(t.hex, t.height);
    if (pointInPoly(p.x, p.y, g.top) || g.walls.some((w) => pointInPoly(p.x, p.y, w.poly))) return t.id;
  }
  return null;
}
