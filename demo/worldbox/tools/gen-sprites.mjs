// Генератор піксельних спрайтів для демо в дусі WorldBox. Запуск: node tools/gen-sprites.mjs
// Результат: sprites/*.png + manifest.js. Щоб замінити арт — просто підмініть PNG (ті самі імена) або поправте manifest.js.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(OUT, 'sprites'), { recursive: true });

// ---------- PNG ----------
const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- Полотно ----------
const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), 255];
class Img {
  constructor(w, h) { this.w = w; this.h = h; this.d = Buffer.alloc(w * h * 4); }
  set(x, y, c) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= this.w || y >= this.h || !c) return; const i = (y * this.w + x) * 4; const v = typeof c === 'string' ? hex(c) : c; this.d[i] = v[0]; this.d[i + 1] = v[1]; this.d[i + 2] = v[2]; this.d[i + 3] = v[3]; }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
  disc(cx, cy, r, c) { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r * 0.6) this.set(cx + x, cy + y, c); }
  save(name) { writeFileSync(join(OUT, 'sprites', name + '.png'), png(this.w, this.h, this.d)); }
}
let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const manifest = { scale: 3, tile: 16, tiles: {}, sprites: {} };

// ---------- Тайли 16×16 ----------
function grass(name, flowers) {
  const im = new Img(16, 16); im.rect(0, 0, 16, 16, '#5fb94a');
  for (let i = 0; i < 26; i++) im.set(rnd() * 16, rnd() * 16, rnd() < 0.5 ? '#6fc956' : '#4fa63f');
  for (let i = 0; i < 5; i++) { const x = (rnd() * 14) | 0, y = (rnd() * 14) | 0; im.set(x, y + 1, '#3f9035'); im.set(x, y, '#3f9035'); }
  if (flowers) for (let i = 0; i < flowers; i++) { const x = 1 + ((rnd() * 13) | 0), y = 1 + ((rnd() * 13) | 0); const c = ['#ffe45e', '#ff7aa8', '#ffffff', '#8ad8ff'][(rnd() * 4) | 0]; im.set(x, y, c); im.set(x, y + 1, '#3f9035'); }
  im.save(name); manifest.tiles[name] = { file: `sprites/${name}.png` };
}
grass('grass1', 0); grass('grass2', 0); grass('grass3', 0); grass('grass_flowers', 3);
function dirt(name) {
  const im = new Img(16, 16); im.rect(0, 0, 16, 16, '#c9a066');
  for (let i = 0; i < 30; i++) im.set(rnd() * 16, rnd() * 16, rnd() < 0.5 ? '#d8b277' : '#b28850');
  for (let i = 0; i < 4; i++) im.set(rnd() * 16, rnd() * 16, '#8d6a3c');
  im.save(name); manifest.tiles[name] = { file: `sprites/${name}.png` };
}
dirt('dirt');
function water(name, shade) {
  const im = new Img(16, 16); im.rect(0, 0, 16, 16, shade ? '#2f7fd6' : '#3a8fe6');
  for (let i = 0; i < 5; i++) { const x = (rnd() * 12) | 0, y = (rnd() * 15) | 0; im.rect(x, y, 3 + ((rnd() * 2) | 0), 1, '#8cc8ff'); }
  im.save(name); manifest.tiles[name] = { file: `sprites/${name}.png` };
}
water('water', false);
function sand(name) {
  const im = new Img(16, 16); im.rect(0, 0, 16, 16, '#f0dc8c');
  for (let i = 0; i < 24; i++) im.set(rnd() * 16, rnd() * 16, rnd() < 0.5 ? '#fff0a8' : '#d9c474');
  im.save(name); manifest.tiles[name] = { file: `sprites/${name}.png` };
}
sand('sand');

// ---------- Об'єкти ----------
function reg(name, im, ax, ay) { im.save(name); manifest.sprites[name] = { file: `sprites/${name}.png`, w: im.w, h: im.h, ax, ay }; }
function tree(name, pine) {
  const im = new Img(24, 32);
  im.rect(10, 22, 4, 9, '#7a4a22'); im.rect(10, 22, 1, 9, '#5d3717'); im.rect(13, 22, 1, 9, '#946033');
  if (!pine) {
    for (const [cx, cy, r, c] of [[12, 11, 10, '#2f8f3a'], [8, 14, 7, '#2f8f3a'], [16, 14, 7, '#2f8f3a'], [11, 9, 7, '#3fae48'], [9, 11, 4, '#58c75a']]) im.disc(cx, cy, r, c);
    for (let i = 0; i < 6; i++) im.set(5 + rnd() * 14, 6 + rnd() * 14, '#6fdc68');
    for (let i = 0; i < 6; i++) im.set(4 + rnd() * 16, 14 + rnd() * 8, '#226f2c');
  } else {
    for (let t = 0; t < 3; t++) { const top = 1 + t * 7, hw = 4 + t * 3; for (let y = 0; y < 10; y++) { const w = Math.round((hw * (y + 1)) / 10); im.rect(12 - w, top + y, w * 2, 1, y > 6 ? '#1f6b34' : '#2a8a42'); } }
    for (let i = 0; i < 14; i++) im.set(5 + rnd() * 14, 4 + rnd() * 18, '#4fb35a');
  }
  reg(name, im, 12, 31);
}
tree('tree1', false); tree('tree2', true);
function bush() { const im = new Img(16, 12); for (const [cx, cy, r, c] of [[8, 7, 5, '#2f8f3a'], [4, 8, 3, '#3fae48'], [12, 8, 3, '#3fae48']]) im.disc(cx, cy, r, c); im.set(6, 6, '#e8465a'); im.set(10, 8, '#e8465a'); im.set(5, 9, '#e8465a'); reg('bush', im, 8, 11); }
bush();
function rock() { const im = new Img(16, 12); im.disc(8, 7, 5, '#8a8f98'); im.disc(5, 8, 3, '#9aa0a9'); im.disc(11, 8, 3, '#7a7f88'); im.rect(5, 5, 3, 1, '#c0c6d0'); im.rect(3, 10, 11, 1, '#5a5e66'); reg('rock', im, 8, 11); }
rock();
function house() {
  const im = new Img(48, 48);
  im.rect(6, 22, 36, 24, '#e6d2a4'); im.rect(6, 22, 36, 2, '#f4e4bc'); im.rect(6, 44, 36, 2, '#9c8456'); im.rect(6, 22, 2, 24, '#c0a876'); im.rect(40, 22, 2, 24, '#c0a876');
  for (let y = 0; y < 8; y++) im.rect(2 + y, 22 - 3 - y * 2 + 14, 44 - y * 2, 2, y % 2 ? '#c4432f' : '#d65a3e'); // не використовується (підстраховка)
  im.rect(0, 0, 48, 22, [0, 0, 0, 0]);
  for (let y = 0; y < 18; y++) { const inset = Math.floor(y * 0.9); im.rect(inset, 2 + y, 48 - inset * 2, 1, y % 3 === 2 ? '#a83a28' : y % 3 === 1 ? '#c4432f' : '#d65a3e'); }
  im.rect(3, 19, 42, 3, '#8a2f20');
  im.rect(19, 30, 10, 16, '#7a4a22'); im.rect(20, 31, 8, 14, '#946033'); im.set(26, 38, '#ffd24a');
  im.rect(10, 28, 7, 7, '#5d3717'); im.rect(11, 29, 5, 5, '#8fd2ff'); im.rect(13, 29, 1, 5, '#5d3717');
  im.rect(32, 28, 7, 7, '#5d3717'); im.rect(33, 29, 5, 5, '#8fd2ff'); im.rect(35, 29, 1, 5, '#5d3717');
  im.rect(34, 0, 5, 12, '#8a8f98'); im.rect(33, 0, 7, 2, '#6a6f78'); // димар
  reg('house', im, 24, 46);
}
house();
function well() { const im = new Img(20, 24); im.rect(3, 12, 14, 10, '#9aa0a9'); im.rect(3, 12, 14, 2, '#c0c6d0'); im.rect(5, 14, 10, 3, '#2f7fd6'); im.rect(3, 20, 14, 2, '#6a6f78'); im.rect(3, 3, 2, 10, '#7a4a22'); im.rect(15, 3, 2, 10, '#7a4a22'); for (let y = 0; y < 4; y++) im.rect(1 + y, y, 18 - y * 2, 1, '#c4432f'); reg('well', im, 10, 22); }
well();
function fence() { const im = new Img(16, 12); im.rect(1, 2, 2, 9, '#946033'); im.rect(13, 2, 2, 9, '#946033'); im.rect(0, 4, 16, 2, '#b07a42'); im.rect(0, 8, 16, 2, '#b07a42'); reg('fence', im, 8, 11); }
fence();

// ---------- Персонажі 20×20 з шарами ----------
const BASE = [
  '......OOOOO.....',
  '.....OHHHHHO....',
  '....OHHHHHHHO...',
  '....OHHHHHSSO...',
  '....OHHHSSWSO...',
  '....OHHSSSSSO...',
  '.....OSSSSSO....',
  '......OOOOO.....',
  '.....OBBBBBO....',
  '....OBBBBBBBO...',
  '...OSOBBDBBOSO..',
  '...OSOBBBBBOSO..',
  '....OBBBBBBBO...',
  '.....OPPOPPO....',
  '.....OPPOPPO....',
  '.....OPPOPPO....',
  '....OEEOOEEO....',
  '....OOO..OOO....',
];
const PAL = { O: '#2a1d2e', W: '#ffffff', E: '#4a2f1a', G: '#d8dee8', g: '#9aa3b3', Y: '#ffd24a', R: '#d63a3a', T: '#8a5a2b', M: '#c06cff', C: '#6fe0ff', X: '#5a3a1a', L: '#2d6a3a' };
const SKIN = { human: '#f2c9a0', elf: '#f6dcc0', orc: '#6aa84f', dwarf: '#e6b48a' };
function layer(im, rows, ox, oy, pal) { rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch !== '.') im.set(ox + x, oy + y, pal[ch] ?? PAL[ch]); })); }
function person(name, o) {
  const im = new Img(20, 20);
  layer(im, BASE, 2, 1, { H: o.hair, S: SKIN[o.race ?? 'human'], B: o.body, D: o.bodyDark, P: o.pants, ...(o.pal ?? {}) });
  for (const [rows, ox, oy] of o.extra ?? []) layer(im, rows, ox, oy, { H: o.hair, ...(o.pal ?? {}) });
  reg(name, im, 10, 19);
}
const swordRows = ['.G', '.G', '.G', '.G', '.G', '.G', '.G', '.G', 'YYY', '.T'];
const shieldRows = ['.RRRR.', 'RYYYYR', 'RYRRYR', 'RYRRYR', 'RYYYYR', '.RRRR.'];
const axeRows = ['..GGG.', '.GGGGG', '.GGGG.', '..T...', '..T...', '..T...', '..T...', '..T...', '..T...', '..T...', '..T...'];
const staffRows = ['.MMM.', 'MCCCM', '.MMM.', '..T..', '..T..', '..T..', '..T..', '..T..', '..T..', '..T..', '..T..', '..T..', '..T..', '..T..'];
const hatRows = ['.....OO.....', '....OPPO....', '...OPPPPO...', '..OPPPPPPO..', 'OOOOOOOOOOOO'];
const bowRows = ['..TT', '.T.W', 'T..W', 'T..W', 'T..W', 'T..W', 'T..W', '.T.W', '..TT'];
const clubRows = ['.XX.', 'XXXX', 'XXXX', '.XX.', '.XX.', '.X..', '.X..', '.X..', '.X..'];
const capeRows = ['RR', 'RR', 'RR', 'RR', 'RR', 'R.'];
person('warrior', { hair: '#9aa3b3', body: '#3a6fd6', bodyDark: '#2a52a8', pants: '#4a4f6a', extra: [[swordRows, 16, 2], [shieldRows, 0, 10]] });
person('woodcutter', { hair: '#6a3a1a', body: '#d65a3e', bodyDark: '#a83a28', pants: '#5d4a2a', extra: [[axeRows, 15, 7]] });
person('mage', { hair: '#8a4cd6', body: '#7a4cd6', bodyDark: '#5a34a8', pants: '#3a2a6a', pal: { P: '#7a4cd6' }, extra: [[staffRows, 15, 3], [hatRows, 4, -1]] });
person('archer', { hair: '#d6a23a', body: '#3aa05a', bodyDark: '#2a7a42', pants: '#6a5a2a', race: 'elf', extra: [[bowRows, 16, 7]] });
person('dwarf', { hair: '#c0602a', body: '#a8782a', bodyDark: '#7a5418', pants: '#5a4020', race: 'dwarf', extra: [[axeRows, 15, 7], [['....', '.HH.', 'HHHH', 'HHHH'], 6, 6]] });
person('orc', { hair: '#3a2a1a', body: '#6a4a2a', bodyDark: '#4a321a', pants: '#3a3a3a', race: 'orc', extra: [[clubRows, 16, 8]] });
function slime() {
  const im = new Img(16, 12); im.disc(8, 7, 5, '#3ad65a'); im.rect(2, 7, 12, 4, '#3ad65a'); im.rect(3, 10, 10, 1, '#2aa044');
  im.rect(0, 11, 16, 1, [0, 0, 0, 0]); im.rect(5, 5, 2, 2, '#ffffff'); im.rect(10, 5, 2, 2, '#ffffff'); im.set(6, 6, '#2a1d2e'); im.set(11, 6, '#2a1d2e'); im.rect(5, 3, 2, 1, '#9affb0');
  reg('slime', im, 8, 11);
}
slime();
function skeleton() {
  const im = new Img(20, 20);
  layer(im, BASE, 2, 1, { H: '#e8e8e0', S: '#f4f4ec', B: '#d8d8d0', D: '#b0b0a8', P: '#c8c8c0', W: '#2a1d2e' });
  layer(im, swordRows, 16, 2, {});
  reg('skeleton', im, 10, 19);
}
skeleton();

manifest.characters = [
  { sprite: 'warrior', name: 'Воїн', speed: 34 }, { sprite: 'woodcutter', name: 'Лісоруб', speed: 30 },
  { sprite: 'mage', name: 'Маг', speed: 26 }, { sprite: 'archer', name: 'Ельф-лучник', speed: 44 },
  { sprite: 'dwarf', name: 'Гном', speed: 24 }, { sprite: 'orc', name: 'Орк', speed: 32 },
  { sprite: 'slime', name: 'Слиз', speed: 16, hop: 6 }, { sprite: 'skeleton', name: 'Скелет', speed: 28 },
];
writeFileSync(join(OUT, 'manifest.js'), '// Згенеровано tools/gen-sprites.mjs. Можна правити вручну: додавайте свої PNG у sprites/ і описуйте тут.\nwindow.WB_MANIFEST = ' + JSON.stringify(manifest, null, 2) + ';\n');
console.log('ok', Object.keys(manifest.sprites).length, 'sprites');
