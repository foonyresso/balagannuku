/** Піксельні примітиви для процедурних спрайтів (стиль «Kingdom»). Лише 2D-canvas, без залежностей від Pixi. */
export type Ctx = CanvasRenderingContext2D;
export type Pt = readonly [number, number];
export type Fill = string | ((x: number, y: number) => string);

export function mk(w: number, h: number): { cv: HTMLCanvasElement; c: Ctx } {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  return { cv, c };
}

/** Детермінований ГПВЧ (mulberry32) — спрайти однакові між запусками. */
export function rng(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function rgb(col: string): [number, number, number] {
  const n = parseInt(col.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const h2 = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
export const toCss = (r: number, g: number, b: number): string => `#${h2(r)}${h2(g)}${h2(b)}`;
/** Множить колір на f (<1 темніше, >1 світліше). */
export function shade(col: string, f: number): string {
  const [r, g, b] = rgb(col);
  return toCss(r * f, g * f, b * f);
}
/** Змішує два кольори (t = 0 → a, 1 → b). */
export function mix(a: string, b: string, t: number): string {
  const x = rgb(a), y = rgb(b);
  return toCss(lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t));
}

export function disc(c: Ctx, cx: number, cy: number, r: number, col: string): void {
  c.fillStyle = col;
  for (let dy = -r; dy <= r; dy++) {
    const w = Math.floor(Math.sqrt(r * r - dy * dy) + 0.5);
    c.fillRect(cx - w, cy + dy, w * 2 + 1, 1);
  }
}

export function inPoly(x: number, y: number, p: readonly Pt[]): boolean {
  let o = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if ((p[i][1] > y) !== (p[j][1] > y) && x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) o = !o;
  }
  return o;
}

/** Піксельна заливка полігона; колір — рядок або функція від координат пікселя (текстура). */
export function poly(c: Ctx, p: readonly Pt[], col: Fill): void {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of p) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
    for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
      if (!inPoly(x + 0.5, y + 0.5, p)) continue;
      const f = typeof col === 'function' ? col(x, y) : col;
      if (!f) continue; // порожній колір = прозорий піксель (сітка, ґрати)
      c.fillStyle = f;
      c.fillRect(x, y, 1, 1);
    }
  }
}

/** Лінія в 1 піксель (Брезенхем). */
export function line(c: Ctx, x0: number, y0: number, x1: number, y1: number, col: string): void {
  c.fillStyle = col;
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    c.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/** Контур полігона в 1 піксель. */
export function outline(c: Ctx, p: readonly Pt[], col: string): void {
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; line(c, a[0], a[1], b[0], b[1], col); }
}

export const rect = (c: Ctx, x: number, y: number, w: number, h: number, col: string): void => { c.fillStyle = col; c.fillRect(x, y, w, h); };
