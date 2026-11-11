import { Container, Sprite, Texture } from 'pixi.js';
import { mk, lerp } from './pixel';
import type { Camera } from '../projection';

/** Пора доби: ambient-колір (множиться на кадр), сила вогнів, віньєтка, колір серпанку, кількість світляків. */
export interface TimePreset { amb: [number, number, number]; fire: number; vig: number; fog: [number, number, number]; flies: number }
export const TIMES = {
  dusk: { amb: [0.62, 0.52, 0.66], fire: 1, vig: 0.5, fog: [200, 170, 200], flies: 0.7 },
  night: { amb: [0.24, 0.3, 0.5], fire: 1.3, vig: 0.68, fog: [120, 140, 190], flies: 1 },
  dawn: { amb: [0.86, 0.72, 0.66], fire: 0.6, vig: 0.36, fog: [255, 220, 200], flies: 0.2 },
} satisfies Record<string, TimePreset>;
export type TimeKey = keyof typeof TIMES;
export const TIME_KEYS = Object.keys(TIMES) as TimeKey[];
export const nextTime = (k: TimeKey): TimeKey => TIME_KEYS[(TIME_KEYS.indexOf(k) + 1) % TIME_KEYS.length];

const rgb2hex = (r: number, g: number, b: number) => (Math.round(Math.max(0, Math.min(1, r)) * 255) << 16) | (Math.round(Math.max(0, Math.min(1, g)) * 255) << 8) | Math.round(Math.max(0, Math.min(1, b)) * 255);

function radial(size: number, stops: [number, string][]): Texture {
  const { cv, c } = mk(size, size);
  const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [t, col] of stops) g.addColorStop(t, col);
  c.fillStyle = g; c.fillRect(0, 0, size, size);
  const t = Texture.from(cv); t.source.scaleMode = 'linear';
  return t;
}

interface Glow { s: Sprite; base: number; flick: number; phase: number }

/**
 * Освітлення й повітря: множник ambient, додаткові «світіння» вогнів, серпанок, світляки, віньєтка.
 * Шари: `world` (дрейфуючий туман — у координатах світу, кладеться в root), `lights` (адитивні вогні — зі світовою камерою),
 * `screen` (ambient, серпанок, світляки, віньєтка — на весь екран). Порядок на сцені: root, screen.multiply, lights, screen.top.
 */
export class Atmosphere {
  readonly world = new Container();
  readonly lights = new Container();
  /** Множник ambient (під вогнями). */
  readonly multiply = new Sprite(Texture.WHITE);
  /** Світляки, серпанок і віньєтка (над вогнями). */
  readonly top = new Container();
  private haze = new Sprite(Texture.WHITE);
  private vignette: Sprite;
  private glowTex = radial(128, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,.45)'], [1, 'rgba(255,255,255,0)']]);
  private fogTex = radial(128, [[0, 'rgba(255,255,255,.55)'], [1, 'rgba(255,255,255,0)']]);
  private glows: Glow[] = [];
  private fogs: { s: Sprite; v: number }[] = [];
  private flies: { s: Sprite; x: number; y: number; ph: number; sp: number }[] = [];
  private amb: [number, number, number] = [...TIMES.dusk.amb];
  private vig = TIMES.dusk.vig;
  private fireK = TIMES.dusk.fire;
  private t = 0;
  key: TimeKey = 'dusk';
  /** LOD: світляки лише при близькому зумі. */
  fliesOn = true;
  private w = 1; private h = 1;
  private bounds: { minX: number; maxX: number };

  constructor(center: { x: number; y: number }, span: number, bounds: { minX: number; maxX: number }) {
    this.bounds = bounds;
    this.multiply.blendMode = 'multiply';
    this.vignette = new Sprite(radial(256, [[0, 'rgba(6,4,12,0)'], [0.55, 'rgba(6,4,12,0)'], [1, 'rgba(6,4,12,1)']]));
    this.haze.alpha = 0.1;
    this.top.addChild(this.haze, this.vignette);
    // туман: м'які еліпси, що пливуть над землею навколо центру міста
    for (let i = 0; i < 10; i++) {
      const s = new Sprite(this.fogTex); s.anchor.set(0.5);
      const k = 3 + ((i * 7) % 5) * 0.8;
      s.scale.set(k * 40, k * 16); s.alpha = 0.13;
      s.position.set(center.x + ((i * 137) % 100 - 50) / 50 * span, center.y + ((i * 61) % 100 - 50) / 50 * span * 0.5);
      this.world.addChild(s); this.fogs.push({ s, v: 3 + (i % 4) * 2 });
    }
    // світляки (екранні)
    for (let i = 0; i < 36; i++) {
      const s = new Sprite(Texture.WHITE); s.tint = 0xe6ff8c; s.blendMode = 'add'; s.width = s.height = 2;
      this.top.addChild(s);
      this.flies.push({ s, x: Math.random(), y: Math.random(), ph: Math.random() * 9, sp: 0.6 + Math.random() * 1.2 });
    }
  }

  setTime(k: TimeKey): void { this.key = k; }

  /** Додає джерело світла (світові ізо-координати); r — радіус у одиницях світу, flicker 0..1 — мерехтіння. Повертає номер. */
  addLight(x: number, y: number, r: number, rgb: string, a: number, flicker = 0): void {
    const s = new Sprite(this.glowTex); s.anchor.set(0.5); s.blendMode = 'add';
    const [cr, cg, cb] = rgb.split(',').map(Number);
    s.tint = (cr << 16) | (cg << 8) | cb; s.position.set(x, y); s.width = s.height = r * 2;
    this.lights.addChild(s);
    this.glows.push({ s, base: a, flick: flicker, phase: Math.random() * 6 });
  }
  clearLights(): void { for (const g of this.glows) g.s.destroy(); this.glows = []; }
  get lightCount(): number { return this.glows.length; }

  /** Камера: світло лежить у світових координатах. */
  setCam(cam: Camera): void { this.lights.position.set(cam.x, cam.y); this.lights.scale.set(cam.zoom); }

  resize(w: number, h: number): void {
    this.w = w; this.h = h;
    this.multiply.width = w; this.multiply.height = h;
    this.haze.width = w; this.haze.height = h;
    this.vignette.width = w * 1.15; this.vignette.height = h * 1.15; this.vignette.position.set(-w * 0.075, -h * 0.075);
  }

  update(dt: number): void {
    this.t += dt;
    const T = TIMES[this.key], k = Math.min(1, dt * 3);
    for (let i = 0; i < 3; i++) this.amb[i] += (T.amb[i] - this.amb[i]) * k;
    this.vig += (T.vig - this.vig) * Math.min(1, dt * 2);
    this.fireK += (T.fire - this.fireK) * k;
    this.multiply.tint = rgb2hex(this.amb[0], this.amb[1], this.amb[2]);
    this.haze.tint = rgb2hex(T.fog[0] / 255, T.fog[1] / 255, T.fog[2] / 255);
    this.vignette.alpha = Math.min(1, this.vig + 0.3);
    for (const g of this.glows) {
      const wob = 0.85 + Math.sin(this.t * 17 + g.phase) * 0.08 + Math.sin(this.t * 9.3 + g.phase) * 0.08;
      g.s.alpha = Math.min(1, g.base * this.fireK * (1 - g.flick + g.flick * wob));
    }
    for (const f of this.fogs) { f.s.x += f.v * dt; if (f.s.x > this.bounds.maxX) f.s.x = this.bounds.minX; }
    for (let i = 0; i < this.flies.length; i++) {
      const f = this.flies[i];
      if (!this.fliesOn) { f.s.visible = false; continue; }
      f.s.visible = true;
      f.ph += dt * f.sp;
      f.x = (f.x + Math.cos(f.ph * 0.7) * dt * 0.01 + 1) % 1; f.y = (f.y + Math.sin(f.ph * 0.9) * dt * 0.012 + 1) % 1;
      const on = (Math.sin(f.ph * 2) + 1) / 2;
      f.s.position.set(f.x * this.w, f.y * this.h);
      f.s.alpha = i < this.flies.length * T.flies && on > 0.3 ? on : 0;
    }
  }
}
void lerp;

/** Віньєтка на весь екран (для карти): темні краї, як у місті. */
export function makeVignette(strength = 0.65): { sprite: Sprite; resize: (w: number, h: number) => void } {
  const sprite = new Sprite(radial(256, [[0, 'rgba(6,4,12,0)'], [0.55, 'rgba(6,4,12,0)'], [1, 'rgba(6,4,12,1)']]));
  sprite.alpha = strength;
  return { sprite, resize: (w, h) => { sprite.width = w * 1.15; sprite.height = h * 1.15; sprite.position.set(-w * 0.075, -h * 0.075); } };
}
