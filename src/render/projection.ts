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
