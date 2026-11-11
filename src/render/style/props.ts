import { defineSprite } from './atlas';
import { disc, poly, rng, type Ctx } from './pixel';

/** Одиниць площини на тексель для природних об'єктів. */
export const PROP_SCALE = 0.35;
export const OAK_VARIANTS = 5, PINE_VARIANTS = 3, ROCK_VARIANTS = 3, BUSH_VARIANTS = 3;

function oak(seed: number, big: boolean) {
  return (c: Ctx) => {
    const R = rng(seed), cx = 28;
    c.fillStyle = '#241a20'; c.fillRect(cx - 2, 46, 5, 24); c.fillRect(cx - 4, 66, 9, 4);
    c.fillStyle = '#3a2a2c'; c.fillRect(cx - 2, 46, 1, 22);
    const blobs: [number, number, number][] = [];
    for (let i = 0; i < (big ? 9 : 7); i++) blobs.push([cx + (R() - 0.5) * 26, 30 + (R() - 0.5) * 22, 8 + R() * 5]);
    blobs.push([cx, 24, 12]);
    for (const [x, y, r] of blobs) disc(c, Math.round(x), Math.round(y), Math.round(r), '#1b2a2b');
    for (const [x, y, r] of blobs) disc(c, Math.round(x - 1), Math.round(y - 2), Math.round(r - 2), '#2c4638');
    for (const [x, y, r] of blobs) disc(c, Math.round(x - 3), Math.round(y - 4), Math.round(r - 5), '#46663f');
    for (let i = 0; i < 40; i++) {
      const [x, y, r] = blobs[Math.floor(R() * blobs.length)];
      c.fillStyle = R() < 0.5 ? '#7d8f4c' : '#5d7a45';
      c.fillRect(Math.round(x - 4 + R() * 3), Math.round(y - r + 1 + R() * 4), 1, 1);
    }
    c.fillStyle = '#1b2a2b';
    for (let i = 0; i < 30; i++) c.fillRect(8 + Math.floor(R() * 40), 40 + Math.floor(R() * 8), 1, 1);
  };
}

function pine(seed: number) {
  return (c: Ctx) => {
    const R = rng(seed), cx = 20;
    c.fillStyle = '#241a20'; c.fillRect(cx - 1, 56, 3, 14);
    for (let k = 0; k < 5; k++) {
      const top = 6 + k * 11, hh = 16 + k * 2, hw = 6 + k * 3;
      poly(c, [[cx, top], [cx + hw, top + hh], [cx - hw, top + hh]], (x, y) => (x < cx - (y - top) * 0.1 ? '#2c4a43' : '#1a2b30'));
      c.fillStyle = '#4f7154';
      for (let i = 0; i < 6; i++) {
        const yy = top + 3 + Math.floor(R() * (hh - 4));
        c.fillRect(cx - Math.floor(((yy - top) / hh) * hw) + Math.floor(R() * 4), yy, 1, 1);
      }
    }
  };
}

function bush(seed: number) {
  return (c: Ctx) => {
    const R = rng(seed);
    for (let i = 0; i < 4; i++) disc(c, 6 + i * 4, 7 + ((R() * 2) | 0), 4, '#1f3230');
    for (let i = 0; i < 4; i++) disc(c, 5 + i * 4, 6 + ((R() * 2) | 0), 3, '#3a5a3e');
    for (let i = 0; i < 8; i++) { c.fillStyle = R() < 0.3 ? '#d8b0b8' : '#6f8a4a'; c.fillRect((3 + R() * 16) | 0, (3 + R() * 6) | 0, 1, 1); }
  };
}

function rock(seed: number, r: number) {
  return (c: Ctx) => {
    const R = rng(seed), cx = 16, cy = 16;
    const blobs: [number, number, number][] = [[cx, cy - 2, r], [cx - r * 0.7, cy + 1, r * 0.6], [cx + r * 0.8, cy + 1, r * 0.55]];
    for (const [x, y, rr] of blobs) disc(c, Math.round(x), Math.round(y), Math.round(rr), '#2b2a33');
    for (const [x, y, rr] of blobs) disc(c, Math.round(x - 1), Math.round(y - 1), Math.round(rr - 1), '#555563');
    for (const [x, y, rr] of blobs) disc(c, Math.round(x - 2), Math.round(y - 3), Math.max(1, Math.round(rr - 3.5)), '#7d7d8c');
    for (let i = 0; i < 14; i++) { c.fillStyle = R() < 0.5 ? '#9a9aa8' : '#3c3b46'; c.fillRect(cx - r + ((R() * r * 2) | 0), cy - r + ((R() * r * 1.6) | 0), 1, 1); }
    c.fillStyle = '#4b6a3e';
    for (let i = 0; i < 5; i++) c.fillRect(cx - r + ((R() * r * 2) | 0), cy + 2, 2, 1); // мох біля основи
  };
}

export const TUFT_VARIANTS = 3;
function tuft(seed: number) {
  return (c: Ctx) => {
    const R = rng(seed);
    for (let i = 0; i < 5; i++) {
      const x = 2 + i * 2 + ((R() * 2) | 0), h = 4 + ((R() * 5) | 0);
      c.fillStyle = i % 2 ? '#4f6f3a' : '#6f8f45';
      for (let y = 0; y < h; y++) c.fillRect(x + (y > h - 3 ? ((R() * 2) | 0) - 1 : 0), 11 - y, 1, 1);
    }
  };
}

export function registerProps(): void {
  // Спрощене дерево для дальнього LOD: одна пляма крони + стовбур (мало пікселів, виглядає як ліс здалеку)
  defineSprite({ id: 'treefar', w: 16, h: 20, ax: 8, ay: 19, scale: PROP_SCALE * 3.4, paint: (c) => {
    c.fillStyle = '#241a20'; c.fillRect(7, 13, 2, 6);
    disc(c, 8, 8, 7, '#2c4638'); disc(c, 7, 7, 5, '#46663f');
  } });
  for (let i = 0; i < TUFT_VARIANTS; i++) defineSprite({ id: `tuft${i}`, w: 16, h: 12, ax: 8, ay: 11, scale: 0.5, paint: tuft(i * 23 + 3) });
  for (let i = 0; i < OAK_VARIANTS; i++) defineSprite({ id: `oak${i}`, w: 56, h: 72, ax: 28, ay: 70, scale: PROP_SCALE, paint: oak((i + 1) * 77, i === 2) });
  for (let i = 0; i < PINE_VARIANTS; i++) defineSprite({ id: `pine${i}`, w: 40, h: 72, ax: 20, ay: 70, scale: PROP_SCALE, paint: pine((i + 1) * 31) });
  for (let i = 0; i < BUSH_VARIANTS; i++) defineSprite({ id: `bush${i}`, w: 24, h: 14, ax: 12, ay: 13, scale: PROP_SCALE, paint: bush((i + 1) * 13) });
  // Каміння: брили й «розсип» (розбитий вузол, що відростає)
  for (let i = 0; i < ROCK_VARIANTS; i++) defineSprite({ id: `rock${i}`, w: 32, h: 24, ax: 16, ay: 20, scale: 0.5, paint: rock(i * 19 + 5, 8 + i) });
  defineSprite({ id: 'rubble', w: 32, h: 24, ax: 16, ay: 20, scale: 0.5, paint: rock(99, 3) });
  // Пеньок і саджанець (зрубане дерево)
  defineSprite({ id: 'stump', w: 16, h: 14, ax: 8, ay: 12, scale: PROP_SCALE, paint: (c) => {
    c.fillStyle = '#241a20'; c.fillRect(4, 6, 8, 6); c.fillStyle = '#5a4030'; c.fillRect(5, 6, 6, 5); c.fillStyle = '#c9a070'; c.fillRect(5, 4, 6, 3); c.fillStyle = '#8a6a48'; c.fillRect(7, 5, 2, 1);
  } });
  defineSprite({ id: 'sapling', w: 16, h: 18, ax: 8, ay: 16, scale: PROP_SCALE, paint: (c) => {
    c.fillStyle = '#3a2a2c'; c.fillRect(7, 8, 1, 8); disc(c, 8, 7, 3, '#2c4638'); disc(c, 7, 6, 2, '#5d7a45');
  } });
  // Ноша над головою: колоди, камінь, дошки, їжа, мішок
  const bundles: Record<string, (c: Ctx) => void> = {
    wood: (c) => { for (const [x, y] of [[1, 5], [1, 2], [4, 3]]) { c.fillStyle = '#5a3f2c'; c.fillRect(x, y, 8, 2); c.fillStyle = '#c9a070'; c.fillRect(x + 7, y, 1, 2); } },
    stone: (c) => { disc(c, 5, 5, 3, '#3c3b46'); disc(c, 5, 4, 2, '#8a8a98'); c.fillStyle = '#b8b8c4'; c.fillRect(4, 3, 1, 1); },
    planks: (c) => { for (let i = 0; i < 3; i++) { c.fillStyle = i % 2 ? '#d9b27a' : '#c49a62'; c.fillRect(1, 2 + i * 2, 9, 2); } },
    food: (c) => { disc(c, 5, 5, 3, '#6b3a24'); disc(c, 5, 4, 2, '#d8b66a'); c.fillStyle = '#e8d596'; c.fillRect(4, 3, 1, 1); },
    sack: (c) => { disc(c, 5, 5, 3, '#4a3a2c'); disc(c, 5, 4, 2, '#a48a64'); c.fillStyle = '#2a1f1a'; c.fillRect(4, 1, 3, 1); },
  };
  for (const [k, p] of Object.entries(bundles)) defineSprite({ id: `bundle_${k}`, w: 10, h: 10, ax: 5, ay: 10, scale: 0.4, paint: p });
}
