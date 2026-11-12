import { FOOTPRINT } from '../../sim/balance';
import { ISO_Y, ISO_Z } from '../projection';
import { defineSprite, hasSprite, spr, type Spr } from './atlas';
import { outline, poly, rect, rng, shade, type Ctx, type Pt } from './pixel';

/**
 * Споруди «Kingdom» у НАШІЙ проєкції (src/render/projection.ts). Проєкція лише масштабує осі (x → x, y → y·ISO_Y, z → −z·ISO_Z),
 * тож видно тільки фасад (грань +y), дахи й верх (бокові стіни рівні ребру). Спрайт малюється мініатюрним «3D»-малювальником
 * `BPainter`: грані задаються в одиницях площини (x вправо, y вглиб від задньої межі до фасаду, z угору), а в піксель їх переводить
 * та сама формула, що й у карті, — будинок завжди стоїть правильно на косій землі.
 *
 * Додати споруду: `registerBuildingStyle('kind', { zMax, paint(p) {...}, fx })`; без стилю діє запасний (коробка з дахом).
 */
export const B_TEXEL = 0.4; // одиниць площини на тексель
const PAD = 8;
const DARK = '#1c1519';

export type Mat = (x: number, y: number) => string;
export interface FxPoint { x: number; y: number; z: number }
export interface FxLight extends FxPoint { r: number; rgb: string; a: number }
/** Ефекти споруди в локальних координатах (x 0..w, y 0..d, z вгору): світло (вогні, вікна) і дим. */
export interface BuildingFx { lights: FxLight[]; smoke: FxPoint[] }
export interface BuildingStyle {
  /** Найбільша висота малюнка (z), одиниці площини. */
  zMax: number;
  paint(p: BPainter): void;
}

// ---------- матеріали ----------
const hash = (x: number, y: number): number => { let n = Math.imul(x * 374761393 + y * 668265263, 1274126177); n = (n ^ (n >>> 13)) >>> 0; return n / 4294967296; };
export const plain = (a: string): Mat => () => a;
/** Дошки: вертикальні шви + горизонтальні стики. */
export const planks = (a: string, b: string, step = 4): Mat => (x, y) => (y % step === 0 ? b : (x + Math.floor(y / step) * 7) % 11 === 0 ? b : hash(x, y) < 0.06 ? b : a);
/** Колоди: горизонтальні смуги зі світлішим верхом. */
export const logs = (a: string, b: string, step = 4): Mat => (x, y) => { const r = ((y % step) + step) % step; return r === 0 ? b : r === 1 ? shade(a, 1.18) : hash(x, y) < 0.05 ? b : a; };
/** Мурування цеглою/каменем зі зсувом рядів. */
export const bricks = (a: string, b: string, h = 4): Mat => (x, y) => { const row = Math.floor(y / h), off = (row % 2) * 4; return y % h === 0 || (x + off) % 8 === 0 ? b : hash(x >> 1, y) < 0.18 ? shade(a, 1.12) : a; };
/** Дах: лусочки/черепиця рядами. */
export const shingles = (a: string, b: string, h = 4): Mat => (x, y) => { const row = Math.floor(y / h), off = (row % 2) * 3; return (y % h === 0) ? b : (x + off) % 6 === 0 ? shade(b, 1.1) : a; };
/** Солома/трава: дрібні штрихи. */
export const thatch = (a: string, b: string): Mat => (x, y) => ((x * 3 + y * 5) % 7 === 0 || hash(x, y) < 0.1 ? b : a);
export const stripes = (a: string, b: string, step: number): Mat => (x, y) => (y % step === 0 ? b : hash(x, y) < 0.05 ? b : a);

export class BPainter {
  readonly fx: BuildingFx = { lights: [], smoke: [] };
  /** Площина фасаду основного об'єму (для вікон і дверей). */
  yf = 0;
  constructor(readonly c: Ctx, readonly w: number, readonly d: number, readonly zMax: number) {}

  /** Точка (x, y, z) у пікселях спрайта. */
  P(x: number, y: number, z: number): Pt {
    return [PAD + x / B_TEXEL, PAD + (y * ISO_Y - z * ISO_Z + this.zMax * ISO_Z) / B_TEXEL];
  }

  /** Довільна грань із 3D-точок; shade — множник освітлення; контур темний. */
  face(pts: readonly (readonly [number, number, number])[], mat: Mat, sh = 1, edge = true): void {
    const p = pts.map(([x, y, z]) => this.P(x, y, z));
    poly(this.c, p, (px, py) => { const m = mat(px, py); return m ? shade(m, sh) : ''; });
    if (edge) outline(this.c, p, DARK);
  }
  /** Вертикальний прямокутник на площині y (фасад). */
  wall(x0: number, x1: number, y: number, z0: number, z1: number, mat: Mat, sh = 1): void {
    this.face([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], mat, sh);
  }
  /** Горизонтальний прямокутник на висоті z. */
  top(x0: number, x1: number, y0: number, y1: number, z: number, mat: Mat, sh = 1.12): void {
    this.face([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], mat, sh);
  }
  /** Паралелепіпед: фасад і верх (бокові грані рівні ребру й не видні). */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat: Mat, topMat: Mat = mat): void {
    this.wall(x0, x1, y1, z0, z1, mat);
    this.top(x0, x1, y0, y1, z1, topMat);
  }
  /** Дах із гребенем уздовж y (фасад із фронтоном): два скати + трикутник на фасаді. */
  gableFront(x0: number, x1: number, yb: number, yf: number, zEave: number, rh: number, ov: number, roof: Mat, gable: Mat): void {
    const xm = (x0 + x1) / 2, zr = zEave + rh, k = rh / (xm - x0), ze = zEave - ov * k;
    this.face([[x0, yf, zEave], [x1, yf, zEave], [xm, yf, zr]], gable, 0.92);
    this.face([[x0 - ov, yf + ov, ze], [xm, yf + ov, zr], [xm, yb, zr], [x0 - ov, yb, ze]], roof, 1.16);
    this.face([[x1 + ov, yf + ov, ze], [xm, yf + ov, zr], [xm, yb, zr], [x1 + ov, yb, ze]], roof, 0.78);
  }
  /** Дах із гребенем уздовж x: один скат до глядача (задній прихований, бо кут ската > кута огляду). */
  gableSide(x0: number, x1: number, yb: number, yf: number, zEave: number, rh: number, ov: number, roof: Mat): void {
    const ym = (yb + yf) / 2, k = rh / (yf - ym), ze = zEave - ov * k;
    this.face([[x0 - ov, yf + ov, ze], [x1 + ov, yf + ov, ze], [x1 + ov, ym, zEave + rh], [x0 - ov, ym, zEave + rh]], roof, 1);
  }
  /** Чотирисхилий дах: фронтальний скат і два бокові. */
  hip(x0: number, x1: number, yb: number, yf: number, zEave: number, rh: number, ov: number, ridge: number, roof: Mat): void {
    const xm = (x0 + x1) / 2, ym = (yb + yf) / 2, zr = zEave + rh, kx = rh / (xm - x0 - ridge), ky = rh / (yf - ym);
    const ze = zEave - ov * Math.min(kx, ky);
    this.face([[x0 - ov, yf + ov, ze], [xm - ridge, ym, zr], [xm - ridge, yb - ov, ze]], roof, 1.18);
    this.face([[x1 + ov, yf + ov, ze], [xm + ridge, ym, zr], [xm + ridge, yb - ov, ze]], roof, 0.76);
    this.face([[x0 - ov, yf + ov, ze], [x1 + ov, yf + ov, ze], [xm + ridge, ym, zr], [xm - ridge, ym, zr]], roof, 1);
  }
  /** Скат «лін-ту» (відкритий навіс): низько спереду, високо ззаду. */
  lean(x0: number, x1: number, yb: number, yf: number, zLow: number, zHigh: number, ov: number, roof: Mat): void {
    this.face([[x0 - ov, yf + ov, zLow], [x1 + ov, yf + ov, zLow], [x1 + ov, yb, zHigh], [x0 - ov, yb, zHigh]], roof, 1.02);
  }
  door(xc: number, w: number, h: number, arch = false): void {
    const y = this.yf, x0 = xc - w / 2, x1 = xc + w / 2;
    this.wall(x0 - 0.5, x1 + 0.5, y + 0.01, 0, h + 0.5, plain('#3a2a24'));
    this.wall(x0, x1, y + 0.02, 0, h, (px) => (px % 5 === 0 ? '#2a1d1b' : '#1f1618'));
    if (arch) { const a = this.P(xc, y + 0.03, h + 0.5); rect(this.c, Math.round(a[0]) - 1, Math.round(a[1]), 3, 1, '#3a2a24'); }
    const k = this.P(x1 - 0.8, y + 0.03, h * 0.45); rect(this.c, Math.round(k[0]), Math.round(k[1]), 1, 1, '#d8b26a');
  }
  /** Вікно, що світиться; додає джерело світла для нічного сяйва. */
  window(xc: number, zc: number, w: number, h: number, glow = true): void {
    const y = this.yf + 0.03, x0 = xc - w / 2, x1 = xc + w / 2, z0 = zc - h / 2, z1 = zc + h / 2;
    this.wall(x0 - 0.4, x1 + 0.4, y, z0 - 0.4, z1 + 0.4, plain('#3c2a24'));
    this.wall(x0, x1, y + 0.01, z0, z1, (_px, py) => (py % 3 === 0 ? '#ffe0a0' : '#ffcf7a'));
    const m = this.P(xc, y + 0.02, zc);
    rect(this.c, Math.round(m[0]), Math.round(m[1] - (h / 2) * ISO_Z / B_TEXEL), 1, Math.max(1, Math.round((h * ISO_Z) / B_TEXEL)), '#3c2a24');
    if (glow) this.fx.lights.push({ x: xc, y: y + 1, z: zc, r: 22, rgb: '255,190,90', a: 0.5 });
  }
  chimney(x: number, y: number, z0: number, z1: number): void {
    this.box(x - 1.4, x + 1.4, y - 1.4, y + 1.4, z0, z1, bricks('#4a4044', '#2e2b2e'), plain('#2a2226'));
    this.fx.smoke.push({ x, y, z: z1 + 1 });
  }
  /** Дрібний декор: штабель колод (праворуч/ліворуч від входу). */
  logPile(x: number, y: number, n = 3): void {
    for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
      const lx = x + (j - i / 2) * 1.5, lz = (n - 1 - i) * 1.3 + 0.7;
      this.face([[lx - 0.7, y, lz - 0.7], [lx + 0.7, y, lz - 0.7], [lx + 0.7, y, lz + 0.7], [lx - 0.7, y, lz + 0.7]], plain(j % 2 ? '#c9a070' : '#b88c5c'), 1);
    }
  }
  crate(x: number, y: number, s = 2.6): void {
    this.box(x - s / 2, x + s / 2, y - s / 2, y + s / 2, 0, s, planks('#8a6a48', '#5a4030', 3), planks('#a8824e', '#6a4c38', 3));
  }
  torch(x: number, z: number, lit = true): void {
    const y = this.yf + 0.5;
    this.wall(x - 0.3, x + 0.3, y, z - 2, z, plain('#3a2a28'));
    const f = this.P(x, y + 0.1, z + 0.6);
    rect(this.c, Math.round(f[0]) - 1, Math.round(f[1]) - 1, 2, 3, '#f08a2a'); rect(this.c, Math.round(f[0]) - 1, Math.round(f[1]) - 2, 1, 2, '#ffd25a');
    if (lit) this.fx.lights.push({ x, y: y + 1, z: z + 1, r: 36, rgb: '255,150,70', a: 0.7 });
  }
}

// ---------- стилі за видом ----------
const styles = new Map<string, BuildingStyle>();
export function registerBuildingStyle(kind: string, s: BuildingStyle): void { styles.set(kind, s); }

const WOOD = planks('#5b4335', '#46332b');
const STONE = bricks('#5c585c', '#3f3a3c');
const ROOF_RED = shingles('#6e3438', '#4e2430');
const ROOF_BROWN = shingles('#5a4636', '#3a2c24');
const ROOF_GREEN = shingles('#3c5a3e', '#26402c');
const FOUND = bricks('#4a4548', '#2e2a2c', 3);

/** Фундамент по периметру корпусу. */
function foundation(p: BPainter, x0: number, x1: number, y0: number, y1: number, h = 1.6): void {
  p.box(x0 - 0.6, x1 + 0.6, y0 - 0.6, y1 + 0.6, 0, h, FOUND, plain('#3f3a3c'));
}

registerBuildingStyle('house', { zMax: 24, paint(p) {
  const { w, d } = p, m = 2, x0 = m, x1 = w - m, yb = m + 1, yf = d - m;
  p.yf = yf;
  foundation(p, x0, x1, yb, yf);
  p.wall(x0, x1, yf, 1.6, 9, WOOD);
  p.window(x0 + 5, 5.5, 3.2, 3.4); p.door(w * 0.55, 3.6, 6);
  p.window(x1 - 3.5, 5.5, 2.6, 3);
  p.gableFront(x0, x1, yb, yf, 9, 10, 1.6, ROOF_RED, WOOD);
  p.chimney(x1 - 4.5, yb + 5, 9.5, 17);
} });

registerBuildingStyle('townhall', { zMax: 48, paint(p) {
  const { w, d } = p, m = 4, x0 = m, x1 = w - m, yb = m + 4, yf = d - m;
  p.yf = yf;
  foundation(p, x0, x1, yb, yf, 2.4);
  p.wall(x0, x1, yf, 2.4, 20, STONE);
  // дерев'яний пояс і колони
  p.wall(x0, x1, yf + 0.01, 14.5, 16, WOOD, 0.95);
  for (const cx of [x0 + 1.2, x1 - 1.2, w / 2 - 9, w / 2 + 9]) p.wall(cx - 1, cx + 1, yf + 0.02, 2.4, 20, planks('#4a3a30', '#2e2320'));
  // у вікнах лише м'яке світло: основне джерело світла міста — вогнище перед ратушею, а не сама ратуша
  for (const cx of [w * 0.22, w * 0.78]) { p.window(cx, 10, 3.4, 5, false); p.fx.lights.push({ x: cx, y: yf + 1, z: 10, r: 14, rgb: '255,190,90', a: 0.22 }); }
  p.door(w / 2, 8, 11, true);
  p.torch(w / 2 - 6.5, 8.5, false); p.torch(w / 2 + 6.5, 8.5, false);
  p.hip(x0, x1, yb, yf, 20, 20, 2.6, 10, ROOF_RED);
  // башточка з прапором на даху
  p.box(w / 2 - 3, w / 2 + 3, yb + 8, yb + 14, 26, 36, STONE, plain('#6a6468'));
  p.window(w / 2, 31, 0.01, 0.01, false);
  const t = p.P(w / 2 + 3.5, yb + 14, 36);
  rect(p.c, Math.round(t[0]), Math.round(t[1]) - 14, 1, 14, '#3a2a28');
  for (let i = 0; i < 9; i++) { rect(p.c, Math.round(t[0]) + 1 + i, Math.round(t[1]) - 14 + (i >> 2), 1, 7 - (i > 5 ? i - 5 : 0), '#8f2f3a'); }
  rect(p.c, Math.round(t[0]) - 1, Math.round(t[1]) - 15, 3, 2, '#e0b84a');
  p.fx.smoke.push({ x: x0 + 6, y: yb + 4, z: 24 });
} });

registerBuildingStyle('warehouse', { zMax: 24, paint(p) {
  const { w, d } = p, m = 2, x0 = m, x1 = w - m, yb = m + 1, yf = d - m;
  p.yf = yf;
  foundation(p, x0, x1, yb, yf);
  p.wall(x0, x1, yf, 1.6, 10, planks('#6a5038', '#4a3828', 5));
  // великі ворота з балками навхрест
  p.wall(w / 2 - 6, w / 2 + 6, yf + 0.02, 1.6, 9, plain('#2a1d1b'));
  p.face([[w / 2 - 6, yf + 0.03, 1.6], [w / 2 - 5, yf + 0.03, 1.6], [w / 2 + 6, yf + 0.03, 9], [w / 2 + 5, yf + 0.03, 9]], plain('#5a4030'), 1, false);
  p.face([[w / 2 + 6, yf + 0.03, 1.6], [w / 2 + 5, yf + 0.03, 1.6], [w / 2 - 6, yf + 0.03, 9], [w / 2 - 5, yf + 0.03, 9]], plain('#5a4030'), 1, false);
  p.window(x0 + 3, 7, 2, 2, false);
  p.gableSide(x0, x1, yb, yf, 10, 7, 1.8, ROOF_BROWN);
  p.crate(x0 + 2, yf + 2.2); p.crate(x0 + 5.2, yf + 2.2, 2); p.crate(x1 - 2.5, yf + 2.2, 3);
  p.torch(w / 2 - 8, 6);
} });

registerBuildingStyle('lumberjack', { zMax: 22, paint(p) {
  const { w, d } = p, m = 1.6, x0 = m, x1 = w - m - 3, yb = m + 1, yf = d - m - 1;
  p.yf = yf;
  foundation(p, x0, x1, yb, yf, 1);
  p.wall(x0, x1, yf, 1, 7.6, logs('#6b4a2e', '#3f2a1c'));
  p.door((x0 + x1) / 2 - 1, 3.2, 5.4); p.window(x1 - 3, 4.6, 2.4, 2.4);
  p.gableFront(x0, x1, yb, yf, 7.6, 7, 1.4, ROOF_GREEN, logs('#6b4a2e', '#3f2a1c'));
  p.chimney(x0 + 3.5, yb + 4, 8, 14);
  p.logPile(w - 2.2, yf + 1.5, 4);
  // пеньок із сокирою
  p.box(x0 + 0.5, x0 + 3, yf + 1, yf + 3.6, 0, 1.8, logs('#8a6a48', '#5a4030', 3), plain('#c9a070'));
  p.wall(x0 + 1.4, x0 + 1.8, yf + 3.7, 1.8, 4.6, plain('#7a5230'));
  p.wall(x0 + 0.8, x0 + 2.4, yf + 3.71, 3.6, 4.8, plain('#aab0bc'));
} });

registerBuildingStyle('quarry', { zMax: 20, paint(p) {
  const { w, d } = p, m = 1.6, x0 = m, x1 = w - m - 3, yb = m + 1, yf = d - m - 1;
  p.yf = yf;
  foundation(p, x0, x1, yb, yf, 1.2);
  p.wall(x0, x1, yf, 1.2, 7, bricks('#6a6670', '#403d48'));
  p.door((x0 + x1) / 2, 3.4, 5.2); p.window(x1 - 3, 4.6, 2.2, 2.4);
  p.gableFront(x0, x1, yb, yf, 7, 6.5, 1.2, shingles('#4e4c58', '#34323e'), bricks('#6a6670', '#403d48'));
  p.chimney(x0 + 3.2, yb + 3.5, 7.5, 12);
  // купа каменю й блок
  for (const [dx, dz, s] of [[0, 0, 3.4], [3.4, 0, 2.8], [1.5, 2.8, 2.6]]) p.box(w - 6 + dx, w - 6 + dx + s, yf + 0.6, yf + 0.6 + s * 0.7, dz, dz + s * 0.8, bricks('#8a8a98', '#5a5a68', 3), plain('#a8a8b6'));
  p.wall(x0 + 0.5, x0 + 0.9, yf + 2, 0, 5, plain('#7a5230'));
  p.wall(x0 - 0.3, x0 + 1.7, yf + 2.01, 4.4, 5.2, plain('#aab0bc'));
} });

registerBuildingStyle('sawmill', { zMax: 22, paint(p) {
  const { w, d } = p, m = 2, x0 = m, x1 = w - m, yb = m + 2, yf = d - m;
  p.yf = yf;
  p.top(x0, x1, yb, yf, 0.2, planks('#5a4a3a', '#403428', 4), 0.9); // дощата підлога
  p.wall(x0, x1, yb + 0.5, 0.2, 9, planks('#4e3c30', '#382a22', 5), 0.8); // задня стіна (видна під навісом)
  // пилорама: стіл і диск
  p.box(x0 + 6, x1 - 6, yb + 3, yb + 7, 2, 4, planks('#8a6a48', '#5a4030', 3), planks('#a8824e', '#6a4c38', 3));
  const s = p.P(w / 2, yb + 7.2, 7);
  for (let i = -5; i <= 5; i++) for (let j = -5; j <= 5; j++) if (i * i + j * j <= 25 && i * i + j * j >= 4) rect(p.c, Math.round(s[0]) + i, Math.round(s[1]) + j, 1, 1, (i + j) % 3 === 0 ? '#e6eaf0' : '#aab0bc');
  // стовпи й навіс
  for (const cx of [x0 + 0.6, x1 - 0.6]) p.wall(cx - 0.7, cx + 0.7, yf, 0.2, 9.5, planks('#6a5038', '#3f2a1c'));
  p.lean(x0, x1, yb, yf, 9.5, 15, 1.6, ROOF_BROWN);
  // штабелі дощок
  for (let i = 0; i < 4; i++) p.box(x1 - 8, x1 - 1, yf - 5 - i * 0.01, yf - 1, i * 1.3 + 0.2, i * 1.3 + 1.5, stripes('#d9b27a', '#a8824e', 3), plain('#e8c48a'));
  p.fx.lights.push({ x: w / 2, y: yf, z: 6, r: 30, rgb: '255,190,90', a: 0.35 });
} });

/** Поле ферми: плоский шар під землею будівлі (по ньому ходять фермери), малюється окремим спрайтом. */
registerBuildingStyle('farm_field', { zMax: 4, paint(p) {
  const { w, d } = p;
  const soil: Mat = (_x, y) => (y % 4 === 0 ? '#3f2e22' : y % 4 === 1 ? '#8a6a3e' : y % 4 === 2 ? '#a88c52' : '#6a4e30');
  const crops: Mat = (x, y) => (y % 4 === 1 && x % 3 !== 0 ? (hash(x, y) < 0.5 ? '#7fa14c' : '#c8b24c') : y % 4 === 0 ? '#3f2e22' : y % 4 === 2 ? '#a88c52' : '#6a4e30');
  p.top(1.5, w - 1.5, 20, d - 2.5, 0.1, soil, 1);
  p.top(20, w - 1.5, 2.5, 20, 0.1, soil, 1);
  p.top(5, w - 5, 24, d - 5, 0.12, crops, 1);
  p.top(24, w - 5, 5, 24, 0.12, crops, 1);
} });

registerBuildingStyle('farm', { zMax: 18, paint(p) {
  const { w, d } = p;
  // хата-комора позаду зліва (поле лежить окремим плоским шаром)
  p.yf = 17;
  p.box(2, 17, 2, 17, 0, 6.4, WOOD, plain('#3c2a24'));
  p.door(8, 3, 4.6); p.window(13.4, 4.2, 1.8, 2);
  p.gableFront(2, 17, 2, 17, 6.4, 5, 1.2, thatch('#c9a85a', '#8a6a38'), WOOD);
  // низький тин уздовж переднього краю
  for (let x = 2; x <= w - 2; x += 5) p.wall(x - 0.4, x + 0.4, d - 1, 0, 3, plain('#6a4c38'));
  p.wall(2, w - 2, d - 1, 1.2, 1.9, plain('#8a6a48')); p.wall(2, w - 2, d - 1, 2.3, 3, plain('#8a6a48'));
  // опудало посеред поля
  const sx = w / 2, sy = d / 2 + 6;
  p.wall(sx - 0.3, sx + 0.3, sy, 0, 6, plain('#5a4030')); p.wall(sx - 2.4, sx + 2.4, sy + 0.01, 3.6, 4.2, plain('#6a4c38'));
  p.wall(sx - 1.1, sx + 1.1, sy + 0.02, 6, 7.8, plain('#d8c890')); p.wall(sx - 1.6, sx + 1.6, sy + 0.03, 7.6, 8.2, plain('#8f2f3a'));
} });

registerBuildingStyle('hunter', { zMax: 22, paint(p) {
  const { w, d } = p, m = 1.6, x0 = m, x1 = w - m - 3, yb = m + 1, yf = d - m - 1;
  p.yf = yf;
  foundation(p, x0, x1, yb, yf, 1);
  p.wall(x0, x1, yf, 1, 7.4, logs('#5b4a34', '#33281c'));
  p.door((x0 + x1) / 2, 3.2, 5.4); p.window(x1 - 2.8, 4.6, 2.2, 2.4);
  p.gableFront(x0, x1, yb, yf, 7.4, 6.5, 1.4, thatch('#5d6f3e', '#3a4a2a'), logs('#5b4a34', '#33281c'));
  // роги над дверима
  const a = p.P((x0 + x1) / 2, yf + 0.05, 7.6);
  for (const s of [-1, 1]) for (let i = 0; i < 5; i++) rect(p.c, Math.round(a[0]) + s * (1 + i), Math.round(a[1]) - 2 - (i > 2 ? i - 2 : 0), 1, 1, '#d8d0b8');
  // рама для сушіння шкур
  for (const px of [w - 7, w - 1.6]) p.wall(px - 0.3, px + 0.3, yf + 1, 0, 6.5, plain('#5a4030'));
  p.wall(w - 7, w - 1.6, yf + 1.01, 5.6, 6.2, plain('#6a4c38'));
  p.wall(w - 6.2, w - 4.6, yf + 1.02, 2.2, 5.6, plain('#a8805c')); p.wall(w - 4.2, w - 2.4, yf + 1.02, 2.8, 5.6, plain('#8a6a48'));
} });

registerBuildingStyle('fisher', { zMax: 22, paint(p) {
  const { w, d } = p, m = 1.6, x0 = m, x1 = w - m - 3, yb = m + 1, yf = d - m - 1;
  p.yf = yf;
  foundation(p, x0, x1, yb, yf, 1);
  p.wall(x0, x1, yf, 1, 7, planks('#6a7a80', '#46565c'));
  p.door((x0 + x1) / 2 + 1, 3.2, 5.2); p.window(x0 + 3, 4.4, 2.4, 2.4);
  p.gableFront(x0, x1, yb, yf, 7, 6.5, 1.4, shingles('#3a5e78', '#26445a'), planks('#6a7a80', '#46565c'));
  p.chimney(x1 - 3, yb + 4, 7.5, 13);
  // сітка для сушіння + рибка
  for (const px of [w - 7, w - 1.6]) p.wall(px - 0.3, px + 0.3, yf + 1, 0, 6, plain('#5a4030'));
  p.wall(w - 7, w - 1.6, yf + 1.01, 2, 5.6, (x, y) => ((x + y) % 3 === 0 ? '#c8c8b0' : ''), 1);
  p.wall(w - 6, w - 5, yf + 1.02, 1, 2.4, plain('#9fb8c8'));
  // діжка з рибою
  p.box(x0 + 0.5, x0 + 3.5, yf + 1, yf + 3.6, 0, 2.4, planks('#7a5a3c', '#4a3020', 3), plain('#2a4a5a'));
} });

/** Запасний стиль: коробка з дахом — щоб нова споруда без арту вже виглядала цілісно. */
function fallbackStyle(kind: string): BuildingStyle {
  const R = rng([...kind].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7));
  const hue = (v: number) => shade('#7a6a58', 0.8 + v * 0.5);
  const wall = planks(hue(R()), '#3c2f28'), roof = shingles(hue(R()), '#2e2430');
  return { zMax: 26, paint(p) {
    const { w, d } = p, m = 2, x0 = m, x1 = w - m, yb = m + 1, yf = d - m;
    p.yf = yf;
    foundation(p, x0, x1, yb, yf);
    p.wall(x0, x1, yf, 1.6, 9, wall);
    p.door(w / 2, 3.6, 6); p.window(x0 + 4, 5.5, 3, 3);
    p.gableSide(x0, x1, yb, yf, 9, 8, 1.6, roof);
  } };
}

// ---------- спрайти ----------
const spriteId = (kind: string, w: number, d: number) => `bld:${kind}:${w}x${d}`;
const fxCache = new Map<string, BuildingFx>();

/** Розміри полотна й якір спрайта споруди w×d (одиниць площини) для стилю. Чиста функція. */
export function buildingCanvas(zMax: number, w: number, d: number): { cw: number; ch: number; ax: number; ay: number } {
  const p = new BPainter(null as unknown as Ctx, w, d, zMax);
  const [ax, ay] = p.P(0, d, 0);
  return { cw: Math.ceil(w / B_TEXEL) + 2 * PAD, ch: Math.ceil((d * ISO_Y + zMax * ISO_Z) / B_TEXEL) + 2 * PAD, ax, ay };
}

export function defineBuilding(kind: string, tw: number, th: number, tile: number): void {
  const id = spriteId(kind, tw, th);
  if (hasSprite(id)) return;
  const style = styles.get(kind) ?? fallbackStyle(kind);
  const w = tw * tile, d = th * tile, { cw, ch, ax, ay } = buildingCanvas(style.zMax, w, d);
  defineSprite({ id, w: cw, h: ch, ax, ay, scale: B_TEXEL, paint: (c) => {
    const p = new BPainter(c, w, d, style.zMax);
    style.paint(p);
    fxCache.set(id, p.fx);
  } });
}

/** Спрайт споруди + її ефекти (світло/дим); малює спрайт у атлас за потреби. */
export function buildingArt(kind: string, tw: number, th: number, tile: number): { spr: Spr; fx: BuildingFx } {
  defineBuilding(kind, tw, th, tile);
  const id = spriteId(kind, tw, th), s = spr(id);
  return { spr: s, fx: fxCache.get(id) ?? { lights: [], smoke: [] } };
}

/** Реєструє спрайти всіх відомих споруд (атлас будується одним аркушем при старті). */
export function registerBuildingSprites(tile: number): void {
  for (const [kind, fp] of Object.entries(FOOTPRINT)) if (fp) { defineBuilding(kind, fp.w, fp.h, tile); if (kind === 'farm') defineBuilding('farm_field', fp.w, fp.h, tile); }
}
