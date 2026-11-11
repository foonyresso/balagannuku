import type { AnimalKind } from '../../shared';
import { defineSprite } from './atlas';
import { rect, type Ctx } from './pixel';

/**
 * Дикі звірі: процедурні спрайти в тому ж стилі, що й персонажі. Дивляться вправо (вліво — дзеркалом).
 * Кадри: idle0/idle1 (друга — голова вниз, пасеться), walk0..3, dead (лежить на боці).
 * Додати звіра: запис у ANIMALS (shared/fauna.ts) + конфіг у LOOK нижче.
 */
export const ANIMAL_SCALE = 0.45;
const W = 52, H = 44, GY = 38, BX = 12;
export const ANIMAL_IDLE_FRAMES = 2, ANIMAL_WALK_FRAMES = 4;
export const animalFrameId = (k: AnimalKind, anim: 'idle' | 'walk' | 'dead', i: number): string => `an:${k}:${anim}${i}`;

interface Look {
  len: number; h: number; legH: number; neck: number;
  body: string; belly: string; dark: string; accent: string;
  head: { w: number; h: number; snout: number; nose: string };
  ears: 'long' | 'pointy' | 'round' | 'deer';
  tail: 'puff' | 'bush' | 'drop' | 'short';
  antlers?: boolean; hump?: boolean; legs: string; tailTip?: string; earTip?: string;
  /** Крок ходьби (текселів): менший = частіше перебирає ногами. */
  stride: number;
}

export const LOOK: Record<AnimalKind, Look> = {
  rabbit: { len: 8, h: 6, legH: 2, neck: 0, body: '#9a8470', belly: '#d8cdb8', dark: '#6e5c4c', accent: '#e8dcc8', head: { w: 4, h: 4, snout: 1, nose: '#d89a9a' }, ears: 'long', tail: 'puff', legs: '#7a6858', stride: 2 },
  hare: { len: 11, h: 6, legH: 4, neck: 0, body: '#b08a5e', belly: '#ead9b8', dark: '#7a5a38', accent: '#f1e8d0', head: { w: 5, h: 4, snout: 1, nose: '#2a2018' }, ears: 'long', earTip: '#2a2018', tail: 'puff', legs: '#8a6a44', stride: 3 },
  fox: { len: 14, h: 6, legH: 4, neck: 0, body: '#c8662a', belly: '#f0e2c8', dark: '#8a3f1c', accent: '#f4ecd8', head: { w: 5, h: 5, snout: 3, nose: '#1a1410' }, ears: 'pointy', tail: 'bush', tailTip: '#f4ecd8', legs: '#2e231c', stride: 3 },
  deer: { len: 17, h: 8, legH: 10, neck: 5, body: '#9a6a3c', belly: '#d9bf94', dark: '#6e4824', accent: '#f1e6cc', head: { w: 5, h: 4, snout: 2, nose: '#2a1c10' }, ears: 'deer', tail: 'short', antlers: true, legs: '#5a3c20', stride: 4 },
  wolf: { len: 16, h: 8, legH: 7, neck: 1, body: '#7a7f88', belly: '#b9bcc4', dark: '#4b4f58', accent: '#d6d8de', head: { w: 6, h: 5, snout: 3, nose: '#14161a' }, ears: 'pointy', tail: 'drop', legs: '#4b4f58', stride: 4 },
  bear: { len: 19, h: 11, legH: 6, neck: 0, body: '#5a3f2b', belly: '#6e4e36', dark: '#3a281a', accent: '#b08a60', head: { w: 7, h: 6, snout: 3, nose: '#14100c' }, ears: 'round', tail: 'short', hump: true, legs: '#3a281a', stride: 4 },
};

interface Pose { sw: [number, number]; lift: [number, number]; bob: number; headDown: number; dead: boolean }

const WALK_POSES: Pose[] = [
  { sw: [2, -2], lift: [0, 0], bob: 0, headDown: 0, dead: false },
  { sw: [0, 0], lift: [2, 2], bob: 1, headDown: 0, dead: false },
  { sw: [-2, 2], lift: [0, 0], bob: 0, headDown: 0, dead: false },
  { sw: [0, 0], lift: [2, 2], bob: 1, headDown: 0, dead: false },
];
const STAND: Pose = { sw: [0, 0], lift: [0, 0], bob: 0, headDown: 0, dead: false };

function paint(c: Ctx, L: Look, p: Pose): void {
  const U = (x: number, up: number, w: number, h: number, col: string) => rect(c, x, GY - up - h, w, h, col);
  // тінь
  c.fillStyle = 'rgba(8,6,16,.38)'; c.fillRect(BX - 1, GY - 1, L.len + 5, 2); c.fillRect(BX + 1, GY + 1, L.len, 1);
  if (p.dead) return paintDead(c, L);
  const bob = p.bob, top = L.legH + L.h + bob;
  // ноги: дальні темніші, ближні — звичайні; sw — виніс уперед/назад, lift — підйом ступні
  const leg = (x: number, sw: number, lift: number, col: string) => { U(x + sw, lift, 2, L.legH + bob - lift + 1, col); U(x + sw + 1, lift, 1, 1, '#1a1410'); };
  const fx = BX + L.len - 4, bx = BX + 1;
  leg(bx + 1, -p.sw[1], p.lift[1], L.dark); leg(fx - 1, -p.sw[0], p.lift[0], L.dark);
  leg(bx, p.sw[1], p.lift[0], L.legs); leg(fx, p.sw[0], p.lift[1], L.legs);
  // тіло
  U(BX, L.legH + 1 + bob, L.len, L.h - 2, L.body); U(BX + 1, L.legH + bob, L.len - 2, 1, L.body); U(BX + 1, top - 1, L.len - 2, 1, L.dark);
  U(BX + 2, L.legH + bob, L.len - 4, 2, L.belly);
  if (L.hump) { U(BX + 3, top, L.len - 9, 2, L.body); U(BX + 4, top + 2, L.len - 12, 1, L.dark); }
  // хвіст
  const tx = BX - 1, tb = L.legH + L.h - 2 + bob;
  if (L.tail === 'puff') { U(tx - 2, tb - 1, 3, 3, L.accent); }
  else if (L.tail === 'bush') { U(tx - 6, tb - 1, 7, 3, L.body); U(tx - 6, tb - 1, 7, 1, L.dark); U(tx - 8, tb - 1, 3, 3, L.tailTip ?? L.body); }
  else if (L.tail === 'drop') { U(tx - 2, tb - 4, 3, 6, L.dark); U(tx - 1, tb - 5, 2, 2, L.body); }
  else U(tx - 1, tb, 2, 2, L.accent);
  // шия й голова
  const hd = p.headDown, hx = BX + L.len - 1 + (L.neck > 2 ? 1 : 0);
  const neckTop = top - 1 + L.neck;
  if (L.neck) U(BX + L.len - 4, top - 2 - (hd ? 0 : 0), 4, L.neck + 2 - hd, L.body);
  const hy = Math.max(1, neckTop - hd * (L.neck > 2 ? 4 : 1)) - (L.neck > 2 ? 0 : 0);
  const headY = L.neck > 2 ? Math.max(L.legH - 1, hy - hd) : top - 4 - hd;
  U(hx, headY, L.head.w, L.head.h, L.body); U(hx, headY, L.head.w, 1, L.dark);
  U(hx + L.head.w, headY, L.head.snout, L.head.h - 1, L.belly === L.accent ? L.body : L.belly);
  U(hx + L.head.w + L.head.snout - 1, headY + L.head.h - 2, 1, 1, L.head.nose);
  U(hx + L.head.w - 2, headY + L.head.h - 2, 1, 1, '#120e10'); // око
  // вуха
  const ex = hx + 1, ey = headY + L.head.h;
  if (L.ears === 'long') { U(ex - 1, ey, 2, 6, L.body); U(ex - 1, ey + 5, 2, 1, L.earTip ?? L.dark); U(ex + 1, ey, 1, 5, L.dark); }
  else if (L.ears === 'pointy') { U(ex, ey, 2, 2, L.body); U(ex, ey + 2, 1, 1, L.body); U(ex + 2, ey, 1, 2, L.dark); }
  else if (L.ears === 'round') { U(ex, ey, 2, 2, L.dark); U(ex + 3, ey, 2, 2, L.dark); }
  else { U(ex - 1, ey, 3, 1, L.body); U(ex - 2, ey, 1, 2, L.dark); }
  if (L.antlers) {
    const col = '#e0d6b0', ax = ex + 1;
    U(ax, ey, 1, 6, col); U(ax - 2, ey + 3, 3, 1, col); U(ax - 3, ey + 3, 1, 3, col); U(ax + 1, ey + 5, 3, 1, col); U(ax + 3, ey + 5, 1, 2, col); U(ax - 1, ey + 5, 1, 2, col);
  }
  if (L.ears === 'deer') U(BX - 1, L.legH + 2 + bob, 2, 3, L.accent); // біла «дзеркальце» на крупі
}

/** Мертвий звір: лежить на боці (плоский силует, ноги вбік). */
function paintDead(c: Ctx, L: Look): void {
  const U = (x: number, up: number, w: number, h: number, col: string) => rect(c, x, GY - up - h, w, h, col);
  const h = Math.max(3, Math.round(L.h * 0.55));
  U(BX, 0, L.len, h, L.body); U(BX + 1, h, L.len - 2, 1, L.body); U(BX + 1, h - 1, L.len - 2, 1, L.dark); U(BX + 2, 0, L.len - 4, 1, L.belly);
  const hx = BX + L.len - 1;
  U(hx, 0, L.head.w, Math.max(3, L.head.h - 1), L.body); U(hx + L.head.w, 0, L.head.snout, 2, L.belly); U(hx + L.head.w - 2, 2, 1, 1, '#120e10');
  // ноги стирчать угору/вбік
  U(BX + 2, h, 2, 2, L.legs); U(BX + L.len - 6, h, 2, 2, L.legs); U(BX + 6, -1, 2, 2, L.dark);
  if (L.tail === 'bush') U(BX - 7, 0, 7, 2, L.body);
  if (L.antlers) { U(hx + 1, 3, 1, 4, '#e0d6b0'); U(hx - 1, 5, 3, 1, '#e0d6b0'); }
}

export function registerAnimals(): void {
  for (const k of Object.keys(LOOK) as AnimalKind[]) {
    const L = LOOK[k];
    const reg = (anim: 'idle' | 'walk' | 'dead', i: number, pose: Pose) =>
      defineSprite({ id: animalFrameId(k, anim, i), w: W, h: H, ax: BX + L.len / 2, ay: GY, scale: ANIMAL_SCALE, paint: (c) => paint(c, L, pose) });
    reg('idle', 0, STAND); reg('idle', 1, { ...STAND, headDown: 1 });
    WALK_POSES.forEach((pose, i) => reg('walk', i, pose));
    reg('dead', 0, { ...STAND, dead: true });
  }
}

/** Кадр ходьби за пройденою відстанню. */
export const animalWalkFrame = (k: AnimalKind, dist: number): number => ((Math.floor(dist / LOOK[k].stride) % ANIMAL_WALK_FRAMES) + ANIMAL_WALK_FRAMES) % ANIMAL_WALK_FRAMES;
