import type { AnimalKind, AnimalState } from '../shared';
import { ANIMALS, ANIMAL_KINDS, ANIMAL_MODE, PROFESSIONS, isActiveTile } from '../shared';
import { hash2 } from './rng';
import { C as CELLS, T as TILES, TPC, getSectorRt, type SectorRt, type SimWorld } from './world';

/** Тіків між спробами появи одного звіра (відновлення популяції). */
export const FAUNA_SPAWN_INTERVAL = 40;
/** Тушка лежить стільки тіків, потім зникає. */
export const CARCASS_TICKS = 400;
/** Звір не підходить до ратуші ближче за стільки тайлів і не лізе в будівлі. */
export const TOWN_KEEPOUT = 34;
/** Радіус появи від ратуші (тайлів). */
export const SPAWN_MAX = 190;
/** Після промаху звір тікає ще стільки тіків. */
export const SCARE_TICKS = 40;

/** Полювання: дальність пострілу, тіків прицілювання, шанс влучання, скільки тіків переслідувати, радіус пошуку здобичі від хатинки. */
export const SHOOT_RANGE = 11, AIM_TICKS = 8, HIT_CHANCE = 0.62, CHASE_GIVEUP = 260, HUNT_RANGE = 230;

const HUNTER = PROFESSIONS.indexOf('hunter');

const R = (w: SimWorld, a: number, b: number, salt: number): number => hash2(a, b, (w.state.world.seed ^ salt) | 0);

export function getAnimal(w: SimWorld, id: number): AnimalState | undefined {
  for (const a of w.state.fauna.animals) if (a.id === id) return a;
  return undefined;
}

export const isAlive = (a: AnimalState): boolean => a.mode !== ANIMAL_MODE.dead;

/** Місця, куди звірі не заходять: ратуші всіх гравців (центри міст). */
function townCenters(w: SimWorld, sector: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const b of w.state.buildings) if (b.kind === 'townhall' && b.sector === sector) out.push({ x: b.entrance.x, y: b.entrance.y });
  return out;
}

function freeTile(rt: SectorRt, x: number, y: number): boolean {
  if (x < 1 || y < 1 || x >= TILES - 1 || y >= TILES - 1 || !isActiveTile(x, y)) return false;
  return rt.occ[(y | 0) * TILES + (x | 0)] === 0;
}

/** Поруч (±2 клітинки) є живий ліс: там звірі й живуть. */
function nearForest(rt: SectorRt, x: number, y: number): boolean {
  const cx = Math.floor(x / TPC), cy = Math.floor(y / TPC);
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const px = cx + dx, py = cy + dy;
    if (px >= 0 && py >= 0 && px < CELLS && py < CELLS && rt.forest[py * CELLS + px]) return true;
  }
  return false;
}

function nearTown(towns: { x: number; y: number }[], x: number, y: number, r: number): boolean {
  for (const t of towns) if (Math.hypot(t.x - x, t.y - y) < r) return true;
  return false;
}

/** Спроба з'явитися звіру виду kind у лісі навколо міста. Повертає true, якщо з'явився. */
export function spawnAnimal(w: SimWorld, kind: AnimalKind, sector: number, salt: number): boolean {
  const towns = townCenters(w, sector);
  if (!towns.length) return false;
  const rt = getSectorRt(w, sector), spec = ANIMALS[kind], f = w.state.fauna;
  for (let attempt = 0; attempt < 14; attempt++) {
    const town = towns[Math.floor(R(w, salt, attempt, 91) * towns.length)];
    const ang = R(w, salt + attempt, f.nextId, 92) * Math.PI * 2;
    const dist = spec.spawnMin + R(w, f.nextId, salt + attempt, 93) * (SPAWN_MAX - spec.spawnMin);
    const x = Math.floor(town.x + Math.cos(ang) * dist), y = Math.floor(town.y + Math.sin(ang) * dist);
    if (!freeTile(rt, x, y) || !nearForest(rt, x, y) || nearTown(towns, x, y, TOWN_KEEPOUT)) continue;
    f.animals.push({
      id: f.nextId++, kind, sector, x: x + 0.5, y: y + 0.5, px: x + 0.5, py: y + 0.5,
      mode: ANIMAL_MODE.idle, tx: x, ty: y, timer: 5 + Math.floor(R(w, x, y, 94) * 40), by: 0,
    });
    return true;
  }
  return false;
}

/** Скільки живих звірів кожного виду. */
export function faunaCounts(w: SimWorld, sector?: number): Record<AnimalKind, number> {
  const c = { rabbit: 0, hare: 0, fox: 0, deer: 0, wolf: 0, bear: 0 } as Record<AnimalKind, number>;
  for (const a of w.state.fauna.animals) if (isAlive(a) && (sector === undefined || a.sector === sector)) c[a.kind]++;
  return c;
}

/** Вид, якому найбільше бракує до цілі (0 — нічого не бракує). */
function neediest(counts: Record<AnimalKind, number>, towns: number): AnimalKind | null {
  let best: AnimalKind | null = null, bd = 0;
  for (const k of ANIMAL_KINDS) {
    const want = ANIMALS[k].target * towns, d = (want - counts[k]) / want;
    if (counts[k] < want && d > bd) { bd = d; best = k; }
  }
  return best;
}

/** Убити звіра (постріл мисливця): стає тушкою. */
export function killAnimal(a: AnimalState): void {
  a.mode = ANIMAL_MODE.dead; a.timer = CARCASS_TICKS; a.px = a.x; a.py = a.y;
}

export function removeAnimal(w: SimWorld, id: number): void {
  const f = w.state.fauna, i = f.animals.findIndex((a) => a.id === id);
  if (i >= 0) f.animals.splice(i, 1);
}

/** Налякати звіра: тікає ще SCARE_TICKS від точки (fx, fy). */
export function scareAnimal(a: AnimalState, fx: number, fy: number): void {
  a.mode = ANIMAL_MODE.flee; a.timer = SCARE_TICKS;
  const d = Math.hypot(a.x - fx, a.y - fy) || 1;
  a.tx = a.x + ((a.x - fx) / d) * 60; a.ty = a.y + ((a.y - fy) / d) * 60;
}

function tryMove(rt: SectorRt, a: AnimalState, nx: number, ny: number): boolean {
  if (!freeTile(rt, Math.floor(nx), Math.floor(ny))) return false;
  a.x = nx; a.y = ny;
  return true;
}

function stepAnimal(w: SimWorld, a: AnimalState, rt: SectorRt, hunters: number[], towns: { x: number; y: number }[], t: number): void {
  const spec = ANIMALS[a.kind], n = w.state.npcs;
  a.px = a.x; a.py = a.y;
  if (a.mode === ANIMAL_MODE.dead) { if (--a.timer <= 0) a.by = -1; return; }
  // Втеча від мисливця
  if (spec.fleeRadius > 0) {
    let near = -1, nd = spec.fleeRadius;
    for (const h of hunters) {
      if (n.sector[h] !== a.sector) continue;
      const d = Math.hypot(n.x[h] - a.x, n.y[h] - a.y);
      if (d < nd) { nd = d; near = h; }
    }
    if (near >= 0) { scareAnimal(a, n.x[near], n.y[near]); a.timer = Math.max(a.timer, 12); }
  }
  if (a.mode === ANIMAL_MODE.flee) {
    if (--a.timer <= 0) { a.mode = ANIMAL_MODE.idle; a.timer = 20 + Math.floor(R(w, a.id, t, 95) * 40); return; }
    const dx = a.tx - a.x, dy = a.ty - a.y, d = Math.hypot(dx, dy) || 1;
    const sx = (dx / d) * spec.fleeSpeed, sy = (dy / d) * spec.fleeSpeed;
    if (tryMove(rt, a, a.x + sx, a.y + sy) || tryMove(rt, a, a.x + sx, a.y) || tryMove(rt, a, a.x, a.y + sy)) return;
    // уперся: біжить убік
    const k = R(w, a.id, t, 96) < 0.5 ? 1 : -1;
    a.tx = a.x - dy * k * 8; a.ty = a.y + dx * k * 8;
    return;
  }
  if (a.mode === ANIMAL_MODE.idle) {
    if (--a.timer > 0) return;
    // нова ціль блукання (не в бік міста й не в будівлі)
    for (let k = 0; k < 6; k++) {
      const ang = R(w, a.id, t + k, 97) * Math.PI * 2, dist = 6 + R(w, t, a.id + k, 98) * 22;
      const x = a.x + Math.cos(ang) * dist, y = a.y + Math.sin(ang) * dist;
      if (freeTile(rt, Math.floor(x), Math.floor(y)) && !nearTown(towns, x, y, TOWN_KEEPOUT) && (spec.aggressive || nearForest(rt, x, y))) {
        a.tx = x; a.ty = y; a.mode = ANIMAL_MODE.wander; return;
      }
    }
    a.timer = 15;
    return;
  }
  // wander
  const dx = a.tx - a.x, dy = a.ty - a.y, d = Math.hypot(dx, dy);
  if (d <= spec.speed) { a.mode = ANIMAL_MODE.idle; a.timer = 15 + Math.floor(R(w, a.id, t, 99) * 70); return; }
  if (!tryMove(rt, a, a.x + (dx / d) * spec.speed, a.y + (dy / d) * spec.speed)) { a.mode = ANIMAL_MODE.idle; a.timer = 10; }
}

/** Один тік фауни: рух, втеча, відновлення популяції. Звірі не блокують економіку: лише тікають і ходять між будівлями. */
export function stepFauna(w: SimWorld): void {
  const f = w.state.fauna, t = w.state.tick, n = w.state.npcs;
  if (!f.animals.length && f.nextId === 1) {
    // перше заселення: одразу до цілей (по секторах із ратушами)
    for (const s of w.state.sectors) {
      if (!townCenters(w, s.id).length) continue;
      for (const k of ANIMAL_KINDS) for (let i = 0; i < ANIMALS[k].target; i++) spawnAnimal(w, k, s.id, k.length * 977 + i * 31 + 1);
    }
    if (!f.animals.length) return; // міста ще немає
  }
  const hunters: number[] = [];
  for (let i = 0; i < n.capacity; i++) if (n.alive[i] && n.profession[i] === HUNTER) hunters.push(i);
  const townsBySector = new Map<number, { x: number; y: number }[]>();
  for (const a of f.animals) {
    let towns = townsBySector.get(a.sector);
    if (!towns) townsBySector.set(a.sector, (towns = townCenters(w, a.sector)));
    stepAnimal(w, a, getSectorRt(w, a.sector), hunters, towns, t);
  }
  if (f.animals.some((a) => a.by === -1)) f.animals = f.animals.filter((a) => a.by !== -1);
  if (t % FAUNA_SPAWN_INTERVAL === 0) {
    for (const s of w.state.sectors) {
      const towns = townCenters(w, s.id).length;
      if (!towns) continue;
      const k = neediest(faunaCounts(w, s.id), towns);
      if (k) spawnAnimal(w, k, s.id, t + 7);
    }
  }
}

/** Найближча вільна здобич (на яку можна полювати, ніхто інший не переслідує) від точки. */
export function findPrey(w: SimWorld, sector: number, x: number, y: number, me: number): AnimalState | null {
  let best: AnimalState | null = null, bd = HUNT_RANGE;
  const n = w.state.npcs;
  for (const a of w.state.fauna.animals) {
    if (a.sector !== sector || !isAlive(a) || !ANIMALS[a.kind].huntable) continue;
    if (a.by > 0 && a.by - 1 !== me && n.alive[a.by - 1]) continue; // вже переслідує інший
    const d = Math.hypot(a.x - x, a.y - y);
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}
