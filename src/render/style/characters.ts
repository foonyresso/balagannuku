import { defineSprite } from './atlas';
import { rect, type Ctx } from './pixel';

/**
 * Персонажі «Kingdom»: кожен кадр — ОДНЕ цілісне зображення (тіло, голова, ноги й інструмент разом), тож ноги не можуть
 * «бігати окремо». Крок прив'язано до пройденої відстані (немає ковзання), «підскок» тіла змінює довжину ходових ніг так,
 * що стегно завжди лишається під плащем. Дивляться вправо; вліво — дзеркалом спрайта.
 *
 * Додати клас: `CLASSES.id = {...}` + (за потреби) `CLASS_OF[profession] = 'id'`.
 */
export const CHAR_SCALE = 0.45;
const W = 32, H = 36, CX = 12, GY = 31; // полотно, вісь тіла, лінія землі
const HIP = 5;

export type Tool = 'none' | 'sword' | 'axe' | 'pick' | 'hammer' | 'hoe' | 'bow' | 'rod' | 'saw';
export interface CharClass {
  cloak: string; trim: string; hood: string; skin: string; tool: Tool;
  hat?: 'straw' | 'hard' | 'plume' | 'cap' | 'crown';
  /** Колір штанів/взуття. */
  legs?: string;
}

export const CLASSES: Record<string, CharClass> = {
  civ: { cloak: '#6e6a72', trim: '#9a948c', hood: '#8a7a64', skin: '#d9a97a', tool: 'none', hat: 'cap' },
  woodcutter: { cloak: '#6e4b2a', trim: '#4c321e', hood: '#4b3320', skin: '#d9a97a', tool: 'axe' },
  miner: { cloak: '#4c5668', trim: '#2c3442', hood: '#d1a84e', skin: '#d9a97a', tool: 'pick', hat: 'hard' },
  carrier: { cloak: '#8a6a40', trim: '#5a4228', hood: '#6a4a2a', skin: '#d9a97a', tool: 'none', hat: 'cap' },
  smith: { cloak: '#4a3a3a', trim: '#2a2020', hood: '#2a2020', skin: '#d9a97a', tool: 'hammer' },
  knight: { cloak: '#7b2f3a', trim: '#b9b9c6', hood: '#a9acb8', skin: '#d9a97a', tool: 'sword', hat: 'plume' },
  builder: { cloak: '#9a7a3e', trim: '#6a4a2a', hood: '#d1a84e', skin: '#d9a97a', tool: 'saw', hat: 'hard' },
  farmer: { cloak: '#7c8a4a', trim: '#5a6a34', hood: '#d8c27a', skin: '#d9a97a', tool: 'hoe', hat: 'straw' },
  archer: { cloak: '#43713d', trim: '#2c4a2a', hood: '#2c4a2a', skin: '#d9a97a', tool: 'bow' },
  fisher: { cloak: '#3f6f8a', trim: '#2a4a5e', hood: '#2a4a5e', skin: '#d9a97a', tool: 'rod', hat: 'cap' },
};
/** Профессія NPC → клас вигляду. */
export const CLASS_OF: Record<string, string> = {
  idle: 'civ', lumberjack: 'woodcutter', miner: 'miner', carrier: 'carrier', smith: 'smith', hero: 'knight', sawyer: 'builder', farmer: 'farmer', hunter: 'archer', fisher: 'fisher',
};
export const classOf = (profession: string): string => (CLASS_OF[profession] ?? 'civ');

// ---------- кадри ----------
export const IDLE_FRAMES = 2;
export const WALK_FRAMES = 4;
/** Кути інструмента по кадрах циклу дії (градуси від горизонталі вперед); кадр удару — HIT. */
const ACT: Record<Tool, { angles: number[]; hit: number }> = {
  none: { angles: [], hit: -1 },
  sword: { angles: [30, 70, 120, 120, -20, 5], hit: 4 },
  axe: { angles: [20, 75, 125, 125, -30, 5], hit: 4 },
  pick: { angles: [25, 80, 130, 130, -25, 5], hit: 4 },
  hammer: { angles: [35, 80, 105, -10, 15], hit: 3 },
  hoe: { angles: [30, 80, 120, -20, 0], hit: 3 },
  saw: { angles: [0, 0, 0, 0], hit: -1 },
  bow: { angles: [0, 0, 0, 0, 0, 0], hit: 5 },
  rod: { angles: [60, 70, 30, 15, 40, 55], hit: -1 },
};
/** Циклів дії за секунду. */
export const actRate = (tool: Tool): number => ({ none: 1, sword: 1.2, axe: 1.4, pick: 1.2, hammer: 1.8, hoe: 1, saw: 1.6, bow: 1.25, rod: 0.3 })[tool];
export const actFrames = (tool: Tool): number => ACT[tool].angles.length;
export const hitFrame = (tool: Tool): number => ACT[tool].hit;
export const toolOf = (cls: string): Tool => (CLASSES[cls] ?? CLASSES.civ).tool;

/** Кадр ходьби за пройденою відстанню (чиста функція): 0..WALK_FRAMES-1. */
export const walkFrame = (dist: number, stride = 2.4): number => ((Math.floor(dist / stride) % WALK_FRAMES) + WALK_FRAMES) % WALK_FRAMES;
/** Кадр циклу дії за часом: t в секундах, rate — циклів за секунду, n — кадрів у циклі. */
export const cycleFrame = (t: number, rate: number, n: number): number => (n <= 0 ? 0 : ((Math.floor(t * rate * n) % n) + n) % n);

export const frameId = (cls: string, anim: 'idle' | 'walk' | 'act', i: number): string => `ch:${cls}:${anim}${i}`;

interface Pose { legA: [number, number]; legB: [number, number]; bob: number; lean: number; head: number; angle: number | null; frame: number; anim: 'idle' | 'walk' | 'act' }

const WALK_POSES: Pick<Pose, 'legA' | 'legB' | 'bob'>[] = [
  { legA: [1, 0], legB: [-1, 0], bob: 0 },
  { legA: [0, 0], legB: [0, 1], bob: 1 },
  { legA: [-1, 0], legB: [1, 0], bob: 0 },
  { legA: [0, 1], legB: [0, 0], bob: 1 },
];

function paint(c: Ctx, k: CharClass, p: Pose): void {
  const R = (dx: number, up: number, w: number, h: number, col: string) => rect(c, CX + dx, GY - up - h, w, h, col);
  const legCol = k.legs ?? '#2a2430', shoe = '#1b161e';
  // тінь (запечена: рухається разом із кадром)
  c.fillStyle = 'rgba(8,6,16,.4)'; c.fillRect(CX - 5, GY - 1, 11, 2); c.fillRect(CX - 3, GY - 2, 7, 1); c.fillRect(CX - 3, GY + 1, 7, 1);
  const bob = p.bob, lean = p.lean, hb = bob + p.head;
  // ноги: від землі до стегна (стегно = низ плаща); довжина = HIP + bob − підйом ступні, тож кріплення не рветься
  const leg = (dx: number, lift: number, x0: number, col: string) => {
    const top = HIP + bob, h = top - lift + 1;
    R(x0 + dx, lift, 2, h, col);
    R(x0 + dx + 1, lift, 1, 1, shoe); // носок уперед
  };
  leg(p.legA[0], p.legA[1], -2, shoe === legCol ? shoe : '#241f2a');
  leg(p.legB[0], p.legB[1], 0, legCol);
  // плащ/тіло (зсув lean — лише верх, ноги лишаються на місці)
  R(-3 + lean, HIP + bob - 1, 6, 8, k.cloak); R(-3 + lean, HIP + bob + 6, 6, 1, k.trim); R(-3 + lean, HIP + bob + 2, 6, 1, '#1b161e');
  R(-4 + lean, HIP + bob + 0, 1, 5, k.cloak); // спина плаща
  if (k.tool === 'sword') { R(2 + lean, HIP + bob, 4, 6, '#2d3f78'); R(3 + lean, HIP + bob + 1, 2, 4, '#c9a24a'); R(2 + lean, HIP + bob, 4, 1, '#9aa0b4'); }
  // голова
  R(-2 + lean, HIP + bob + 7 + p.head, 5, 4, k.skin);
  R(-3 + lean, HIP + bob + 9 + p.head, 6, 3, k.hood); R(-3 + lean, HIP + bob + 7 + p.head, 2, 3, k.hood);
  R(1 + lean, HIP + bob + 8 + p.head, 1, 1, '#1a1418'); // око
  const top = HIP + bob + 12 + p.head;
  if (k.hat === 'straw') { R(-5 + lean, top - 1, 11, 1, k.hood); R(-3 + lean, top, 7, 2, k.hood); R(-3 + lean, top, 7, 1, '#a8883f'); }
  if (k.hat === 'hard') { R(-3 + lean, top - 1, 7, 1, '#b58a36'); R(-2 + lean, top, 5, 2, k.hood); }
  if (k.hat === 'plume') { R(-3 + lean, top - 1, 6, 1, k.hood); R(-4 + lean, top, 2, 3, '#c2323c'); R(-5 + lean, top + 2, 2, 1, '#c2323c'); R(1 + lean, HIP + bob + 8 + p.head, 2, 1, '#2a2a34'); }
  if (k.hat === 'cap') { R(-3 + lean, top - 1, 6, 2, k.hood); R(2 + lean, top - 1, 2, 1, k.hood); }
  void hb;
  // рука вперед (кріпить інструмент до тіла: завжди суцільний силует)
  R(3 + lean, HIP + bob + 5, 2, 2, k.cloak); R(4 + lean, HIP + bob + 5, 1, 2, k.skin);
  // інструмент
  const hx = CX + 3 + lean, hy = GY - HIP - bob - 7;
  const ray = (x0: number, y0: number, a: number, len: number, col: string): [number, number] => {
    const ar = (a * Math.PI) / 180; let ex = x0, ey = y0;
    c.fillStyle = col;
    for (let i = 0; i <= len; i++) { ex = Math.round(x0 + Math.cos(ar) * i); ey = Math.round(y0 - Math.sin(ar) * i); c.fillRect(ex, ey, 1, 1); }
    return [ex, ey];
  };
  const a = p.angle ?? (k.tool === 'sword' ? 75 : k.tool === 'axe' ? 55 : k.tool === 'pick' ? 60 : k.tool === 'hammer' ? 60 : k.tool === 'hoe' ? 70 : k.tool === 'rod' ? 55 : 60);
  if (k.tool === 'sword') {
    ray(hx, hy, a, 9, '#d4d8e0'); rect(c, hx - 1, hy, 3, 1, '#e0b84a');
    if (p.anim === 'act' && p.frame === 4) { c.fillStyle = 'rgba(255,255,255,.55)'; for (let i = 0; i < 8; i++) c.fillRect(hx + 6 + i, hy - 3 + (i >> 1), 1, 1); }
  } else if (k.tool === 'axe') {
    const e = ray(hx, hy, a, 8, '#7a5230'); rect(c, e[0] - 1, e[1] - 2, 3, 4, '#aab0bc'); rect(c, e[0] + 1, e[1] - 2, 1, 4, '#e6eaf0');
  } else if (k.tool === 'pick') {
    const e = ray(hx, hy, a, 8, '#7a5230'); rect(c, e[0] - 2, e[1] - 1, 5, 2, '#aab0bc'); rect(c, e[0] - 2, e[1] - 1, 5, 1, '#e6eaf0');
  } else if (k.tool === 'hammer') {
    const e = ray(hx, hy, a, 6, '#7a5230'); rect(c, e[0] - 1, e[1] - 1, 4, 3, '#9aa0ac'); rect(c, e[0] - 1, e[1] - 1, 4, 1, '#d0d4dc');
  } else if (k.tool === 'hoe') {
    const e = ray(hx, hy, a, 9, '#7a5230'); rect(c, e[0], e[1], 3, 1, '#aab0bc'); rect(c, e[0] + 2, e[1], 1, 2, '#aab0bc');
  } else if (k.tool === 'saw') {
    const off = p.anim === 'act' ? [0, 2, 4, 2][p.frame % 4] : 2;
    rect(c, hx + 1, hy - 1, 5 + off, 2, '#aab0bc'); rect(c, hx + 1, hy - 1, 5 + off, 1, '#e6eaf0'); rect(c, hx, hy - 1, 1, 3, '#7a5230');
  } else if (k.tool === 'bow') {
    const pull = p.anim === 'act' ? [0, 0.3, 0.6, 1, 1, 0][p.frame] : 0;
    const bx = CX + 6 + lean, by = GY - HIP - bob - 13;
    c.fillStyle = '#7a5230';
    for (const [dx, dy] of [[0, 0], [1, 1], [1, 2], [2, 3], [2, 4], [2, 5], [2, 6], [1, 7], [1, 8], [0, 9]]) c.fillRect(bx + (dx - 2), by + dy, 1, 1);
    c.fillStyle = '#d8d0b8'; const sx = bx - 2 - Math.round(pull * 3);
    c.fillRect(bx - 2, by, 1, 1); c.fillRect(sx, by + 1, 1, 8); c.fillRect(bx - 2, by + 9, 1, 1);
    if (p.anim === 'act' && p.frame >= 1 && p.frame <= 4) { c.fillStyle = '#c9c0a0'; for (let i = 0; i < 7; i++) c.fillRect(sx + i, by + 4, 1, 1); c.fillStyle = '#8a8a96'; c.fillRect(sx + 7, by + 4, 1, 1); }
  } else if (k.tool === 'rod') {
    const e = ray(hx, hy, a, 12, '#6a4a32');
    c.fillStyle = '#d8d4c8'; const drop = p.anim === 'act' ? 8 + (p.frame % 3) : 8;
    for (let i = 1; i <= drop; i++) c.fillRect(e[0] + 1, e[1] + i, 1, 1);
    rect(c, e[0], e[1] + drop, 3, 2, '#c2323c'); rect(c, e[0], e[1] + drop, 3, 1, '#f1eada');
  }
}

const POSE0 = { legA: [0, 0] as [number, number], legB: [0, 0] as [number, number], bob: 0, lean: 0, head: 0, angle: null as number | null, frame: 0 };

export function registerCharacters(): void {
  for (const [id, k] of Object.entries(CLASSES)) {
    const reg = (anim: 'idle' | 'walk' | 'act', i: number, pose: Partial<Pose>) =>
      defineSprite({ id: frameId(id, anim, i), w: W, h: H, ax: CX + 1, ay: GY, scale: CHAR_SCALE, paint: (c) => paint(c, k, { ...POSE0, anim, frame: i, ...pose }) });
    for (let i = 0; i < IDLE_FRAMES; i++) reg('idle', i, { head: 0, bob: i, angle: null });
    for (let i = 0; i < WALK_FRAMES; i++) reg('walk', i, { ...WALK_POSES[i], head: 0 });
    const n = actFrames(k.tool), hit = hitFrame(k.tool);
    for (let i = 0; i < n; i++) reg('act', i, { angle: ACT[k.tool].angles[i], lean: i === hit ? 1 : 0, bob: 0 });
  }
}
