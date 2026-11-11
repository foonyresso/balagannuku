import { Texture, TilingSprite } from 'pixi.js';
import { ISO_Y, planeToIso } from '../projection';
import { lerp, mk, rng } from './pixel';

/** Одиниць площини на тексель землі. Візерунок повторюється (тайлиться) і стискається тією ж проєкцією, що й усе. */
export const GROUND_TEXEL = 1.5;
const N = 256;

/** Періодичний value-noise (щоб текстура стикувалася на краях). */
function pnoise(x: number, y: number, s: number, seed: number): number {
  const per = N / s, X = Math.floor(x / s), Y = Math.floor(y / s);
  const h = (a: number, b: number) => { let n = Math.imul(((a % per) + per) % per * 374761393 + ((b % per) + per) % per * 668265263 + seed, 1274126177); n = (n ^ (n >>> 13)) >>> 0; return n / 4294967296; };
  const fx = x / s - X, fy = y / s - Y, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  return lerp(lerp(h(X, Y), h(X + 1, Y), sx), lerp(h(X, Y + 1), h(X + 1, Y + 1), sx), sy);
}

let cached: Texture | null = null;
/** Піксельна трава: постеризовані плями + травинки. */
export function groundTexture(): Texture {
  if (cached) return cached;
  const { cv, c } = mk(N, N), R = rng(4242), img = c.createImageData(N, N), d = img.data;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const n = pnoise(x, y, 64, 1) * 0.6 + pnoise(x, y, 16, 7) * 0.4, q = Math.floor(n * 5) / 5, i = (y * N + x) * 4;
    d[i] = 100 + q * 40; d[i + 1] = 128 + q * 36; d[i + 2] = 70 + q * 26; d[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  for (let i = 0; i < 1400; i++) {
    const x = (R() * N) | 0, y = (R() * N) | 0, s = R();
    c.fillStyle = s < 0.5 ? '#9fb66c' : s < 0.85 ? '#5f7d4a' : '#d7c47a'; c.globalAlpha = s < 0.85 ? 0.65 : 0.5;
    c.fillRect(x, y, 1, 2 + ((R() * 2) | 0));
    if (s < 0.5) c.fillRect((x + 2) % N, (y + 1) % N, 1, 2);
  }
  c.globalAlpha = 1;
  const t = Texture.from(cv);
  t.source.scaleMode = 'nearest'; t.source.addressMode = 'repeat';
  cached = t;
  return t;
}

/** Земля на всю область світу (межі в одиницях площини). */
export function makeGround(b: { minX: number; minY: number; maxX: number; maxY: number }): TilingSprite {
  const tl = planeToIso(b.minX, b.minY), br = planeToIso(b.maxX, b.maxY);
  const g = new TilingSprite({ texture: groundTexture(), width: br.x - tl.x, height: br.y - tl.y });
  g.position.set(tl.x, tl.y);
  g.tileScale.set(GROUND_TEXEL, GROUND_TEXEL * ISO_Y);
  return g;
}
