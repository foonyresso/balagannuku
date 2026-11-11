import { Rectangle, Texture } from 'pixi.js';
import { mk, type Ctx } from './pixel';

/**
 * Реєстр спрайтів стилю. Кожен спрайт — процедурний «малювальник» на 2D-canvas; усі вони пакуються в аркуші-атласи
 * (одна текстура на аркуш → швидке батчування десятків тисяч дерев). Щоб додати новий спрайт — `defineSprite(...)` будь-де
 * до першого `ensureAtlas()`; пізніше зареєстровані пакуються в наступний аркуш.
 */
export interface SpriteDef {
  id: string;
  /** Розмір у текселях. */
  w: number; h: number;
  /** Якір (точка «ніг» / нижнього лівого кута землі) у текселях. */
  ax: number; ay: number;
  /** Одиниць площини на тексель. */
  scale: number;
  paint: (c: Ctx) => void;
}
export interface Spr { tex: Texture; w: number; h: number; ax: number; ay: number; scale: number }

const defs = new Map<string, SpriteDef>();
const built = new Map<string, Spr>();

export function defineSprite(def: SpriteDef): void { defs.set(def.id, def); }
export const hasSprite = (id: string): boolean => defs.has(id);

/** Укладка прямокутників «полицями». Чиста функція (тестується без DOM). */
export function packShelves(items: { id: string; w: number; h: number }[], maxW: number, pad = 1): { at: Map<string, { x: number; y: number }>; width: number; height: number } {
  const at = new Map<string, { x: number; y: number }>();
  const sorted = [...items].sort((a, b) => b.h - a.h || a.id.localeCompare(b.id));
  let x = 0, y = 0, rowH = 0, width = 0;
  for (const it of sorted) {
    if (x + it.w + pad > maxW) { y += rowH + pad; x = 0; rowH = 0; }
    at.set(it.id, { x, y });
    x += it.w + pad; rowH = Math.max(rowH, it.h); width = Math.max(width, x);
  }
  return { at, width, height: y + rowH };
}

const MAX_W = 2048;

/** Пакує всі ще не побудовані спрайти в новий аркуш. */
export function ensureAtlas(): void {
  const todo = [...defs.values()].filter((d) => !built.has(d.id));
  if (!todo.length) return;
  const { at, width, height } = packShelves(todo, MAX_W);
  const { cv, c } = mk(Math.max(1, width), Math.max(1, height));
  for (const d of todo) {
    const p = at.get(d.id)!;
    c.save(); c.translate(p.x, p.y); c.beginPath(); c.rect(0, 0, d.w, d.h); c.clip();
    d.paint(c);
    c.restore();
  }
  const sheet = Texture.from(cv);
  sheet.source.scaleMode = 'nearest';
  for (const d of todo) {
    const p = at.get(d.id)!;
    built.set(d.id, { tex: new Texture({ source: sheet.source, frame: new Rectangle(p.x, p.y, d.w, d.h) }), w: d.w, h: d.h, ax: d.ax, ay: d.ay, scale: d.scale });
  }
}

export function spr(id: string): Spr {
  let s = built.get(id);
  if (!s) { ensureAtlas(); s = built.get(id); }
  if (!s) throw new Error(`Немає спрайта «${id}»`);
  return s;
}

/** Для автотестів: малює спрайт на окремому canvas (без Pixi). */
export function renderSprite(id: string): HTMLCanvasElement {
  const d = defs.get(id);
  if (!d) throw new Error(`Немає спрайта «${id}»`);
  const { cv, c } = mk(d.w, d.h);
  d.paint(c);
  return cv;
}
export const spriteIds = (): string[] => [...defs.keys()];
export const spriteDef = (id: string): SpriteDef | undefined => defs.get(id);
