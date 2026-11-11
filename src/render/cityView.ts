import { Application, Container, Graphics, Sprite } from 'pixi.js';
import type { BuildingKind } from '../shared';
import { ACTIVE_MAX_TILE, ACTIVE_MIN_TILE, SECTOR_CELLS, SECTOR_SIZE, TRAIL_BRUSH_TILES, isActiveCell } from '../shared';
import { genBorderNode, mixNodeSeed } from '../sim/nodegen';
import {
  applyCommand, checkPlace, getSectorRt, idleNpcs, slotsOf, nodeTile, staffBuilding, stepWorld, NODE_TREE, type SimWorld,
} from '../sim';
import { FOOTPRINT, JOB_OF, MAX_WORKERS, NPC_TILES, STONE_TILES, TREE_AMOUNT } from '../sim/balance';
import { NPC_STAT_COUNT, PROFESSIONS, RESOURCE_KINDS, TASKS, statIndex } from '../shared';
import {
  Atmosphere, OAK_VARIANTS, PALETTE, PINE_VARIANTS, Particles, ROCK_VARIANTS, actFrames, actRate, buildingArt, classOf, cycleFrame, frameId, hitFrame, initStyle, nextTime,
  spr, toolOf, treeSpriteId, variant, walkFrame, IDLE_FRAMES, type Tool,
} from './style';
import { ISO_Y, clampCamInside, planeToIso, pointInPoly, screenToPlane, zoomAt, type Camera, type Vec2 } from './projection';
import { Surroundings } from './surroundings';
import { lerpPos, TickClock } from './interp';
import { BuildingGhost } from './buildingGhost';
import { CityHud } from '../ui/cityHud';
import { TickPacer, SPEEDS, isSpeed } from '../ui/pacer';
import { selPos, type Sel } from '../ui/info';

/** Розмір ТАЙЛА в одиницях площини (та сама проєкція, що й у карти): сектор = SECTOR_SIZE тайлів ≈ 1024 одиниці. */
const TILE = 4;
/** У місті можна наблизитись упритул до одного жителя. */
const CITY_ZOOM_MAX = 10;
const FOLLOW_ZOOM = 3.5;
// Шар глибини = один ряд клітинок (BUCKET = TILES_PER_CELL тайлів): вузол клітинки cy завжди лягає в шар cy,
// тож зміну вузлів у рядку можна перемалювати одним шаром.
const NB = SECTOR_CELLS;
const BUCKET = SECTOR_SIZE / NB;


/** Статичний об'єкт шару глибини: спрайти (дерево, камінь, споруда) + поліг. влучання й виділення. */
interface Obj { sprites: Sprite[]; pick: number[] | null; tile: { x: number; y: number } | null; sel: Sel | null }
/** Візуал жителя: спрайт, ноша, лічильники анімації. */
interface NpcVis { s: Sprite; carry: Sprite; lx: number; ly: number; dist: number; dir: number; frame: number; row: number }
const WORK_TASK = TASKS.indexOf('work');
const TREE_YOUNG_SCALE = 0.6;
/** Анімація падіння дерева: хитання, падіння, затухання (секунди). */
const FELL_SHAKE = 0.3, FELL_FALL = 0.75, FELL_FADE = 0.7;
interface Falling { s: Sprite; t: number; dir: number; px: number; py: number; ux: number; uy: number; reach: number; hit: boolean; row: number }
const SIZE_STAT = statIndex('size');
const RES_BUNDLE: Record<string, string> = { wood: 'wood', stone: 'stone', planks: 'planks', food: 'food' };
type Tile = { x: number; y: number };

/** Вигляд міста одного сектора в тій самій ізометрії, що й карта: тайли, пан, зум, малювання за глибиною, пікінг за порядком малювання. */
export class CityView {
  private root = new Container();
  private ground = new Graphics();
  /** Шар глибини = ряд клітинок; у ньому дерева, споруди й жителі, відсортовані за zIndex (= y площини). */
  private rowCont: Container[] = [];
  private npcVis = new Map<number, NpcVis>();
  private atmo: Atmosphere;
  private parts = new Particles();
  private animT = 0;
  private smokers: { x: number; y: number; z: number }[] = [];
  private waterTiles: number[] = [];
  private shine = new Graphics();
  private hoverG = new Graphics();
  private ghost = new BuildingGhost();
  private hud: CityHud;
  /** Режим будівництва: вибрана будівля; null = режим «вибір» (курсор порожній). Після однієї споруди повертається в null. */
  private selected: BuildingKind | null = null;
  private sel: Sel | null = null;
  private hoverSel: Sel | null = null;
  private following = false;
  private targetZoom = 1;
  private pacer = new TickPacer();
  private speed = 1;
  private resumeSpeed = 1;
  private frame = 0;
  private hover: Tile | null = null;
  private cam: Camera;
  private drag: { x: number; y: number; sx: number; sy: number; moved: boolean; button: number; box: boolean; shift: boolean; pick: Sel | null } | null = null;
  private boxEl = document.createElement('div');
  private rows: Obj[][] = Array.from({ length: NB }, () => []);
  private groundDirty = true;

  constructor(private app: Application, private w: SimWorld, private player: string, private sector: number, private onExit: () => void,
    private net: { locked?: boolean; speed?: number; onSpeed?: (s: number) => void } = {}) {
    if (isSpeed(net.speed)) this.speed = net.speed;
    // Сусідні сектори (ландшафт): ряд над домашнім і по боках — під землею, ряд під ним — поверх шарів.
    initStyle(TILE);
    this.surroundings = new Surroundings(app.renderer, w.state.world.seed, w.state.sectors[sector]);
    const bb = Surroundings.bounds(), mid0 = planeToIso((bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2);
    this.atmo = new Atmosphere(mid0, (bb.maxX - bb.minX) * 0.25, { minX: bb.minX, maxX: bb.maxX });
    this.root.addChild(this.surroundings.back);
    this.root.addChild(this.ground);
    this.drawWater();
    this.root.addChild(this.shine);
    for (let r = 0; r < NB; r++) {
      const c = new Container();
      c.sortableChildren = true;
      this.rowCont.push(c);
      this.root.addChild(c);
    }
    this.root.addChild(this.surroundings.front);
    this.drawFog();
    this.root.addChild(this.atmo.world, this.parts.layer);
    this.root.addChild(this.hoverG);
    app.stage.addChild(this.root, this.atmo.multiply, this.atmo.lights, this.atmo.top);
    this.atmo.resize(app.screen.width, app.screen.height);
    app.renderer.on('resize', this.onResize);
    const mid = planeToIso((SECTOR_SIZE * TILE) / 2, (SECTOR_SIZE * TILE) / 2);
    this.cam = { zoom: 1, x: app.screen.width / 2 - mid.x, y: app.screen.height / 2 - mid.y };
    this.applyCam();
    this.hud = new CityHud({
      pickBuild: (k) => this.setBuild(k),
      select: (sel, follow) => this.select(sel, follow),
      deselect: () => this.deselect(),
      follow: (on) => this.setFollow(on),
      back: () => this.onExit(),
      speed: (v) => this.userSpeed(v),
      addWorker: (id) => this.addWorker(id),
      removeWorker: (id) => {
        const b = this.w.byId.get(id);
        if (b) this.cmd({ type: 'set_worker_count', building: id, count: Math.max(0, slotsOf(b) - 1) });
        this.refreshHud();
      },
      assign: (npc, id) => this.assignTo(npc, id),
      unassign: (npc) => { this.cmd({ type: 'unassign_worker', npc }); this.refreshHud(); },
      pause: (id) => { const b = this.w.byId.get(id); if (b) applyCommand(this.w, { player: this.player, seq: 0, cmd: { type: 'set_building_paused', building: id, paused: !b.paused } }); this.refreshHud(); },
      demolish: (id) => {
        const r = applyCommand(this.w, { player: this.player, seq: 0, cmd: { type: 'demolish_building', building: id } });
        if (r.ok) { this.deselect(); this.groundDirty = true; this.rebuild(); this.hud.say('Споруду знесено'); }
      },
    }, w, player, sector);
    this.boxEl.id = 'selBox'; this.boxEl.hidden = true; document.body.appendChild(this.boxEl);
    const el = app.canvas;
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('wheel', this.wheel, { passive: false });
    el.addEventListener('contextmenu', this.noMenu);
    window.addEventListener('keydown', this.key);
    app.ticker.add(this.draw);
    this.rebuild();
    this.refreshHud();
  }

  private clock = new TickClock();
  private surroundings: Surroundings;
  private applyCam(): void {
    this.cam = clampCamInside(this.cam, this.app.screen.width, this.app.screen.height, Surroundings.bounds());
    this.root.position.set(this.cam.x, this.cam.y);
    this.root.scale.set(this.cam.zoom);
    this.atmo.setCam(this.cam);
  }
  private onResize = (): void => this.atmo.resize(this.app.screen.width, this.app.screen.height);

  /** Тайл під курсором: спершу об'єкти від найближчого до глядача (за порядком малювання), далі земля. */
  private pickTile(e: PointerEvent): Tile | null {
    const p = { x: (e.clientX - this.cam.x) / this.cam.zoom, y: (e.clientY - this.cam.y) / this.cam.zoom };
    for (let r = NB - 1; r >= 0; r--) {
      for (const o of this.rows[r]) if (o.pick && o.tile && pointInPoly(p.x, p.y, o.pick)) return o.tile;
    }
    const g = screenToPlane(e.clientX, e.clientY, this.cam);
    const x = Math.floor(g.x / TILE), y = Math.floor(g.y / TILE);
    return x >= 0 && y >= 0 && x < SECTOR_SIZE && y < SECTOR_SIZE ? { x, y } : null;
  }
  /** Лівий верхній тайл footprint, центрованого під курсором. */
  private anchor(t: Tile): Tile {
    const fp = this.selected ? FOOTPRINT[this.selected] : undefined;
    return fp ? { x: t.x - (fp.w >> 1), y: t.y - (fp.h >> 1) } : t;
  }
  private setBuild(k: BuildingKind | null): void {
    this.selected = k;
    if (k) { this.sel = null; this.following = false; }
    this.refreshHud();
  }
  select(sel: Sel, follow: boolean): void {
    this.selected = null;
    this.sel = sel;
    this.setFollow(follow);
  }
  deselect(): void {
    this.sel = null; this.following = false;
    this.refreshHud();
  }
  private setFollow(on: boolean): void {
    this.following = on && !!this.sel;
    if (this.following) this.targetZoom = Math.max(this.cam.zoom, FOLLOW_ZOOM);
    this.refreshHud();
  }
  private refreshHud(): void {
    this.hud.update({ selected: this.sel, build: this.selected, following: this.following, speed: this.speed, actualSpeed: this.pacer.actual, speedLocked: !!this.net.locked });
  }

  /** Екранна позиція жителя (центр тіла) з урахуванням інтерполяції. */
  private npcScreen(i: number): { x: number; y: number } {
    const q = this.npcXY(i), hw = (NPC_TILES * TILE) / 2, iso = planeToIso(q.x * TILE, q.y * TILE, hw);
    return { x: iso.x * this.cam.zoom + this.cam.x, y: iso.y * this.cam.zoom + this.cam.y };
  }

  /** Що під курсором у режимі «вибір»: житель (щедра зона влучання: рухомих важко ловити), потім споруда/дерево/камінь, потім дорога. */
  private pickSel(e: { clientX: number; clientY: number }): Sel | null {
    const z = this.cam.zoom;
    const p = { x: (e.clientX - this.cam.x) / z, y: (e.clientY - this.cam.y) / z };
    const n = this.w.state.npcs, hw = (NPC_TILES * TILE) / 2;
    // Екранні пікселі; на швидкій грі зона більша: жителі встигають втекти, поки рука доходить до кліку
    const R = Math.max(14, hw * z * 1.8) + Math.min(60, this.speed * 4);
    let best = -1, bd = Infinity;
    for (let i = 0; i < n.capacity; i++) {
      if (!n.alive[i] || n.sector[i] !== this.sector) continue;
      const s = this.npcScreen(i), d = Math.hypot(s.x - e.clientX, s.y - e.clientY);
      if (d <= R && d < bd) { best = i; bd = d; }
    }
    if (best >= 0) return { t: 'npc', id: best };
    for (let r = NB - 1; r >= 0; r--) {
      for (const o of this.rows[r]) if (o.sel && o.pick && pointInPoly(p.x, p.y, o.pick)) return o.sel;
    }
    const g = screenToPlane(e.clientX, e.clientY, this.cam);
    const gx = Math.floor(g.x / TILE), gy = Math.floor(g.y / TILE);
    if (gx < 0 || gy < 0 || gx >= SECTOR_SIZE || gy >= SECTOR_SIZE) return null;
    const rt = getSectorRt(this.w, this.sector);
    let st = 0, sx = gx, sy = gy;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = gx + dx, y = gy + dy;
      if (x < 0 || y < 0 || x >= SECTOR_SIZE || y >= SECTOR_SIZE) continue;
      const s2 = rt.stage[y * SECTOR_SIZE + x], half = (TRAIL_BRUSH_TILES[s2] - 1) / 2;
      if (s2 > st && Math.abs(dx) <= half && Math.abs(dy) <= half) { st = s2; sx = x; sy = y; }
    }
    return st ? { t: 'road', x: sx, y: sy } : null;
  }

  /** Позиція жителя, як він намальований (інтерполяція між тіками), у тайлах. */
  private npcXY(i: number): { x: number; y: number } {
    const n = this.w.state.npcs, a = this.clock.alpha(performance.now());
    return { x: lerpPos(this.w.npc.px[i], n.x[i], a), y: lerpPos(this.w.npc.py[i], n.y[i], a) };
  }
  private posOf(sel: Sel): { x: number; y: number } | null {
    if (sel.t === 'group') {
      const ps = sel.items.map((i) => this.posOf(i)).filter((p): p is { x: number; y: number } => !!p);
      return ps.length ? { x: ps.reduce((a, p) => a + p.x, 0) / ps.length, y: ps.reduce((a, p) => a + p.y, 0) / ps.length } : null;
    }
    const p = selPos(this.w, this.sector, sel);
    return p && sel.t === 'npc' ? this.npcXY(sel.id) : p;
  }

  private noMenu = (e: Event): void => e.preventDefault();
  /** Esc: скасувати будівництво, інакше зняти виділення. */
  private key = (e: KeyboardEvent): void => {
    if (e.code === 'KeyN') { this.atmo.setTime(nextTime(this.atmo.key)); this.hud.say(`Пора доби: ${({ dusk: 'сутінки', night: 'ніч', dawn: 'світанок' } as const)[this.atmo.key]}`); return; }
    if (e.code === 'Space') { e.preventDefault(); this.userSpeed(this.speed ? 0 : this.resumeSpeed); return; }
    const d = /^Digit([1-5])$/.exec(e.code); // 1..5 -> 1×, 2×, 5×, 10×, 100×
    if (d) { this.userSpeed(SPEEDS[Number(d[1])]); return; }
    if (e.key !== 'Escape') return;
    if (this.selected) this.setBuild(null); else if (this.sel) this.deselect();
  };

  private move = (e: PointerEvent): void => {
    const d = this.drag;
    if (d) {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (d.box) { // рамка виділення (LMB у режимі «вибір»)
        if (d.moved || Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 4) { d.moved = true; this.showBox(d.sx, d.sy, e.clientX, e.clientY); }
      } else if (d.moved || Math.abs(dx) + Math.abs(dy) > 4) { // пан: ПКМ/СКМ (або ЛКМ у режимі будівництва)
        if (!d.moved && this.following) { this.following = false; this.refreshHud(); } // ручний пан знімає стеження
        d.moved = true; this.cam.x += dx; this.cam.y += dy;
        d.x = e.clientX; d.y = e.clientY; this.applyCam();
      }
    }
    if (this.selected) { this.hover = this.pickTile(e); this.hoverSel = null; this.app.canvas.style.cursor = 'crosshair'; }
    else {
      this.hover = null;
      this.hoverSel = this.drag?.moved ? null : this.pickSel(e);
      this.app.canvas.style.cursor = this.hoverSel ? 'pointer' : 'default';
    }
  };
  private down = (e: PointerEvent): void => {
    try { this.app.canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const box = e.button === 0 && !this.selected;
    // Що було під курсором у момент натискання: житель встигає втекти до відпускання (особливо на 2×–100×)
    this.drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, button: e.button, box, shift: e.shiftKey, pick: box ? this.pickSel(e) : null };
  };
  private showBox(x0: number, y0: number, x1: number, y1: number): void {
    const b = this.boxEl.style;
    this.boxEl.hidden = false;
    b.left = `${Math.min(x0, x1)}px`; b.top = `${Math.min(y0, y1)}px`; b.width = `${Math.abs(x1 - x0)}px`; b.height = `${Math.abs(y1 - y0)}px`;
  }
  /** Виділення рамкою за екранними позиціями. Пріоритет: жителі, інакше споруди, інакше ресурси. */
  private boxSelect(x0: number, y0: number, x1: number, y1: number, additive: boolean): void {
    const r = { x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0: Math.min(y0, y1), y1: Math.max(y0, y1) };
    const n = this.w.state.npcs, z = this.cam.zoom;
    let items: Sel[] = [];
    for (let i = 0; i < n.capacity; i++) {
      if (!n.alive[i] || n.sector[i] !== this.sector) continue;
      const s = this.npcScreen(i);
      if (s.x >= r.x0 && s.x <= r.x1 && s.y >= r.y0 && s.y <= r.y1) items.push({ t: 'npc', id: i });
    }
    if (!items.length) { // споруди: габарит силуету перетинає рамку
      for (const row of this.rows) for (const o of row) {
        if (o.sel?.t !== 'building' || !o.pick) continue;
        let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
        for (let k = 0; k < o.pick.length; k += 2) { a = Math.min(a, o.pick[k]); c = Math.max(c, o.pick[k]); b = Math.min(b, o.pick[k + 1]); d = Math.max(d, o.pick[k + 1]); }
        if (c * z + this.cam.x >= r.x0 && a * z + this.cam.x <= r.x1 && d * z + this.cam.y >= r.y0 && b * z + this.cam.y <= r.y1) items.push(o.sel);
      }
    }
    if (!items.length) { // ресурси: центр у рамці (не більше 200)
      for (const row of this.rows) for (const o of row) {
        if (o.sel?.t !== 'node' || !o.pick || items.length >= 200) continue;
        let cx = 0, cy = 0;
        for (let k = 0; k < o.pick.length; k += 2) { cx += o.pick[k]; cy += o.pick[k + 1]; }
        cx = (cx / (o.pick.length / 2)) * z + this.cam.x; cy = (cy / (o.pick.length / 2)) * z + this.cam.y;
        if (cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1) items.push(o.sel);
      }
    }
    if (additive && this.sel && items.length) { // Shift: додати до поточного виділення (того ж класу)
      const cur = this.sel.t === 'group' ? this.sel.items : [this.sel];
      if (cur[0].t === items[0].t) {
        const seen = new Set(cur.map((i) => JSON.stringify(i)));
        items = [...cur, ...items.filter((i) => !seen.has(JSON.stringify(i)))];
      }
    }
    if (!items.length) { if (!additive) this.deselect(); return; }
    this.select(items.length === 1 ? items[0] : { t: 'group', items }, false);
  }

  private up = (e: PointerEvent): void => {
    const d = this.drag; this.drag = null;
    this.boxEl.hidden = true;
    if (!d) return;
    if (d.box && d.moved) { this.boxSelect(d.sx, d.sy, e.clientX, e.clientY, e.shiftKey || d.shift); return; }
    if (d.moved) return;
    if (d.button === 2) { // ПКМ: скасувати будівництво або виділення
      if (this.selected) this.setBuild(null); else this.deselect();
      return;
    }
    if (d.button !== 0) return;
    if (!this.selected) { // режим «вибір»; житель, що був під курсором при натисканні, має пріоритет
      const s = d.pick?.t === 'npc' ? d.pick : this.pickSel(e);
      if (s && (e.shiftKey || d.shift) && this.sel && this.sel.t === s.t) { // Shift+клік додає
        const cur = this.sel.t === 'group' ? this.sel.items : [this.sel];
        const key = JSON.stringify(s);
        this.select({ t: 'group', items: cur.some((i) => JSON.stringify(i) === key) ? cur.filter((i) => JSON.stringify(i) !== key) : [...cur, s] }, false);
      } else if (s) this.select(s, false); else this.deselect();
      return;
    }
    const t = this.pickTile(e);
    if (!t) return;
    const kind = this.selected;
    const r = applyCommand(this.w, { player: this.player, seq: 0, cmd: { type: 'place_building', kind, sector: this.sector, cell: this.anchor(t) } });
    if (!r.ok) { this.hud.say(r.reason === 'no_resources' ? `Не вистачає: ${this.hud.missingText(kind)}` : 'Тут не можна (зайнято, ліс/камінь поруч або край сектора)'); return; }
    const b = this.w.state.buildings[this.w.state.buildings.length - 1];
    const n = staffBuilding(this.w, this.player, b.id);
    this.hud.say(n ? `Побудовано, працівників: ${n}` : MAX_WORKERS[b.kind] ? 'Побудовано, немає вільних працівників' : 'Побудовано');
    this.selected = null; // одна споруда за вибір: далі курсор порожній
    this.hover = null;
    this.rebuild();
    this.refreshHud();
  };
  private wheel = (e: WheelEvent): void => {
    e.preventDefault();
    const f = Math.exp(-e.deltaY * 0.0015);
    if (this.following) { // під час стеження зум іде до центру екрана, де лежить об'єкт
      this.cam.zoom = this.targetZoom = Math.min(CITY_ZOOM_MAX, Math.max(0.08, this.cam.zoom * f));
    } else this.cam = zoomAt(this.cam, e.clientX, e.clientY, f, 0.08, CITY_ZOOM_MAX);
    this.applyCam();
  };

  /** Прямокутник у тайлах -> ізо-полігон (на висоті z). */
  private quad(tx: number, ty: number, tw: number, th: number, z = 0): number[] {
    const x = tx * TILE, y = ty * TILE, w = tw * TILE, h = th * TILE;
    return [planeToIso(x, y, z), planeToIso(x + w, y, z), planeToIso(x + w, y + h, z), planeToIso(x, y + h, z)].flatMap((v: Vec2) => [v.x, v.y]);
  }

  /** Вода: берегова мілина + глибина (тайли, всі сусіди яких теж вода), каламутний берег і блиск. Горизонтальні серії зливаємо в один прямокутник. */
  private drawWater(): void {
    const rt = getSectorRt(this.w, this.sector), g = new Graphics(), T = SECTOR_SIZE, wt = rt.water;
    const runs = (pred: (i: number) => boolean, color: number) => {
      for (let y = ACTIVE_MIN_TILE; y < ACTIVE_MAX_TILE; y++) {
        let x0 = -1;
        for (let x = ACTIVE_MIN_TILE; x <= ACTIVE_MAX_TILE; x++) {
          const on = x < ACTIVE_MAX_TILE && pred(y * T + x);
          if (on && x0 < 0) x0 = x;
          else if (!on && x0 >= 0) { g.poly(this.quad(x0, y, x - x0, 1)).fill(color); x0 = -1; }
        }
      }
    };
    const near = (i: number) => wt[i - 1] === 1 || wt[i + 1] === 1 || wt[i - T] === 1 || wt[i + T] === 1;
    // берег: суша поруч із водою (поширено на тайл у кожен бік)
    runs((i) => wt[i] !== 1 && (near(i) || wt[i - T - 1] === 1 || wt[i - T + 1] === 1 || wt[i + T - 1] === 1 || wt[i + T + 1] === 1), PALETTE.shore);
    runs((i) => wt[i] === 1, PALETTE.waterShallow);
    runs((i) => wt[i] === 1 && wt[i - 1] === 1 && wt[i + 1] === 1 && wt[i - T] === 1 && wt[i + T] === 1, PALETTE.waterDeep);
    this.root.addChild(g);
    // кандидати блиску: детермінований добір водних тайлів (не більше ~900)
    this.waterTiles = [];
    for (let y = ACTIVE_MIN_TILE; y < ACTIVE_MAX_TILE; y += 3) for (let x = ACTIVE_MIN_TILE; x < ACTIVE_MAX_TILE; x += 3) {
      const i = y * T + x;
      if (wt[i] === 1 && variant(x, y, 5, 3) === 0 && this.waterTiles.length < 1800) this.waterTiles.push(x, y);
    }
  }
  /** Блиск води: кілька «зайчиків» на видимих тайлах, мерехтять за часом. */
  private drawShine(): void {
    const g = this.shine;
    g.clear();
    const wt = this.waterTiles;
    if (!wt.length) return;
    const top = screenToPlane(0, 0, this.cam), bot = screenToPlane(this.app.screen.width, this.app.screen.height, this.cam);
    const x0 = top.x / TILE - 4, x1 = bot.x / TILE + 4, y0 = top.y / TILE - 4, y1 = bot.y / TILE + 4;
    for (let k = 0; k < wt.length; k += 2) {
      const x = wt[k], y = wt[k + 1];
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      if (Math.sin(this.animT * 1.5 + k * 3.1) <= 0.55) continue;
      const c = planeToIso((x + 0.5) * TILE, (y + 0.5) * TILE);
      g.rect(c.x - 1.2, c.y, 2.4, 0.5).fill({ color: 0xc8e6fa, alpha: 0.6 });
    }
  }

  /** Туман неактивної смуги: ступінчасте затемнення до краю карти (поверх лісу й каміння). */
  private drawFog(): void {
    const g = new Graphics(), A = ACTIVE_MIN_TILE, Z = ACTIVE_MAX_TILE, n = 8, step = A / n;
    const frame = (i0: number, i1: number, alpha: number) => { // кільце між відступами i0 < i1 тайлів від активного краю назовні
      const a0 = A - i0, b0 = Z + i0, a1 = A - i1, b1 = Z + i1;
      for (const q of [[a1, a1, b1 - a1, i1 - i0], [a1, b0, b1 - a1, i1 - i0], [a1, a0, i1 - i0, b0 - a0], [b0, a0, i1 - i0, b0 - a0]]) {
        g.poly(this.quad(q[0], q[1], q[2], q[3])).fill({ color: PALETTE.fog, alpha });
      }
    };
    for (let k = 0; k < n; k++) frame(k * step, (k + 1) * step, 0.3 + 0.06 * k);
    this.root.addChild(g);
  }

  /** Стежки й дороги поверх землі (сама трава — тайловий спрайт Surroundings.back): «пензель» шириною за стадією, два тони для живості. */
  private rebuildGround(): void {
    const rt = getSectorRt(this.w, this.sector);
    const g = this.ground;
    g.clear();
    for (let st = 1; st <= 3; st++) {
      const wd = TRAIL_BRUSH_TILES[st], off = (wd - 1) / 2;
      for (let i = 0; i < rt.stage.length; i++) {
        if (rt.stage[i] !== st) continue;
        const tx = i % SECTOR_SIZE, ty = Math.floor(i / SECTOR_SIZE);
        g.poly(this.quad(tx - off, ty - off, wd, wd)).fill(variant(tx, ty, 3, st) === 0 ? PALETTE.trailAlt[st] : PALETTE.trail[st]);
      }
    }
    this.groundDirty = false;
  }

  /** Об'єкт-вузол ресурсу в клітинці (cx, cy) або null. Рядок шару глибини — bucket(nt.y). */
  private nodeObj(rt: ReturnType<typeof getSectorRt>, seed: number, cx: number, cy: number): { row: number; obj: Obj } | null {
    const i = cy * SECTOR_CELLS + cx, border = !isActiveCell(cx, cy);
    const kind = border ? genBorderNode(mixNodeSeed(seed, this.sector), cx, cy) : rt.kind[i];
    if (!kind) return null;
    const res = this.nodeObj0(rt, seed, cx, cy, kind, border);
    if (res && border) { res.obj.sel = null; res.obj.pick = null; } // неактивна смуга: лише вигляд
    return res;
  }
  private nodeObj0(rt: ReturnType<typeof getSectorRt>, seed: number, cx: number, cy: number, kind: number, border: boolean): { row: number; obj: Obj } | null {
    const i = cy * SECTOR_CELLS + cx;
    const nt = nodeTile(seed, this.sector, cx, cy), stage = border ? TREE_AMOUNT : rt.amount[i], grown = stage > 0;
    const px = (nt.x + 0.5) * TILE, py = (nt.y + 0.5) * TILE, tile = { x: nt.x, y: nt.y };
    const base = planeToIso(px, py, 0);
    const row = Math.min(NB - 1, Math.max(0, Math.floor(nt.y / BUCKET)));
    const mk = (id: string, flip: boolean, k = 1): Sprite => {
      const a = spr(id), s = new Sprite(a.tex);
      s.anchor.set(a.ax / a.w, a.ay / a.h); s.scale.set((flip ? -a.scale : a.scale) * k, a.scale * k);
      s.position.set(base.x, base.y); s.zIndex = py;
      return s;
    };
    if (kind === NODE_TREE) {
      const flip = variant(cx, cy, 2, 5) === 1;
      // стадії росту: 0 пеньок, 1 саджанець, 2 молоде (менший розмір), 3 доросле
      const id = stage >= 2 ? treeSpriteId(cx, cy, OAK_VARIANTS, PINE_VARIANTS) : stage === 1 ? 'sapling' : 'stump', k = stage === 2 ? TREE_YOUNG_SCALE : 1;
      const a = spr(id), rw = (a.w * a.scale * k) * 0.32, hh = (a.ay * a.scale * k) * 0.92;
      const ripe = stage >= TREE_AMOUNT;
      return { row, obj: {
        tile, sel: ripe ? { t: 'node', cx, cy } : null, sprites: [mk(id, flip, k)],
        pick: ripe ? [base.x - rw, base.y - hh, base.x + rw, base.y - hh, base.x + rw * 0.4, base.y + 2, base.x - rw * 0.4, base.y + 2] : null,
      } };
    }
    const id = grown ? `rock${variant(cx, cy, ROCK_VARIANTS, 4)}` : 'rubble', a = spr(id), rw = (STONE_TILES * TILE) / 2;
    return { row, obj: {
      tile, sel: { t: 'node', cx, cy }, sprites: [mk(id, variant(cx, cy, 2, 6) === 1)],
      pick: [base.x - rw, base.y - a.ay * a.scale * 0.8, base.x + rw, base.y - a.ay * a.scale * 0.8, base.x + rw, base.y + 2, base.x - rw, base.y + 2],
    } };
  }

  private buildingObjs(rt: ReturnType<typeof getSectorRt>): { row: number; obj: Obj }[] {
    const out: { row: number; obj: Obj }[] = [];
    this.atmo.clearLights();
    this.smokers = [];
    for (const b of rt.buildings) {
      const art = buildingArt(b.kind, b.size.w, b.size.h, TILE), a = art.spr;
      const x0 = b.cell.x * TILE, y0 = b.cell.y * TILE, bw = b.size.w * TILE, bh = b.size.h * TILE;
      const corner = planeToIso(x0, y0 + bh, 0), s = new Sprite(a.tex);
      s.anchor.set(a.ax / a.w, a.ay / a.h); s.scale.set(a.scale); s.position.set(corner.x, corner.y); s.zIndex = y0 + bh;
      const pad = 8 * a.scale, topY = corner.y - (a.ay - 8) * a.scale;
      const pick = [corner.x - pad, topY, corner.x + bw + pad, topY, corner.x + bw + pad, corner.y + 2, corner.x - pad, corner.y + 2];
      for (const l of art.fx.lights) { const q = planeToIso(x0 + l.x, y0 + l.y, l.z); this.atmo.addLight(q.x, q.y, l.r, l.rgb, l.a, 0.8); }
      for (const m of art.fx.smoke) this.smokers.push({ x: x0 + m.x, y: y0 + m.y, z: m.z });
      out.push({ row: Math.min(NB - 1, Math.max(0, Math.floor((b.cell.y + b.size.h - 1) / BUCKET))), obj: {
        tile: b.cell, pick, sel: { t: 'building', id: b.id }, sprites: [s],
      } });
    }
    return out;
  }

  private nodeSpr: (Sprite[] | undefined)[] = [];
  private bldSpr: Sprite[] = [];
  private nodeRows: Obj[][] = Array.from({ length: NB }, () => []);
  private bldRows: Obj[][] = Array.from({ length: NB }, () => []);
  /** Підпис кожного рядка клітинок вузлів (зрубано/виросло): перемальовуємо лише змінені шари глибини. */
  private rowSig: Int32Array = new Int32Array(SECTOR_CELLS).fill(-1);
  private bldSig = '';

  /**
   * Об'єкти (дерева, камінь, будівлі) по шарах глибини. Інкрементально: на великій карті (десятки тисяч вузлів)
   * перебудовуємо лише ті шари, де щось змінилось (зрубане дерево, нова будівля).
   */
  private rebuild(): void {
    const rt = getSectorRt(this.w, this.sector), seed = this.w.state.world.seed;
    if (this.groundDirty) this.rebuildGround();
    this.lastSig = this.signature();
    const dirty = new Set<number>();
    for (let cy = 0; cy < SECTOR_CELLS; cy++) {
      let h = 0;
      for (let cx = 0, i = cy * SECTOR_CELLS; cx < SECTOR_CELLS; cx++, i++) if (rt.kind[i]) h = (Math.imul(h, 31) + (rt.amount[i] + 1) * (i + 1)) | 0;
      if (h === this.rowSig[cy]) continue;
      this.rowSig[cy] = h;
      for (const sp of this.nodeSpr[cy] ?? []) sp.destroy();
      const objs: Obj[] = [];
      for (let cx = 0; cx < SECTOR_CELLS; cx++) { const n = this.nodeObj(rt, seed, cx, cy); if (n) objs.push(n.obj); }
      this.nodeRows[cy] = objs;
      const sprites = objs.flatMap((o) => o.sprites);
      for (const sp of sprites) this.rowCont[cy].addChild(sp);
      this.nodeSpr[cy] = sprites;
      dirty.add(cy);
    }
    const bsig = rt.buildings.map((b) => b.id).join(',');
    if (bsig !== this.bldSig) {
      this.bldSig = bsig;
      for (const sp of this.bldSpr) sp.destroy();
      this.bldSpr = [];
      for (let r = 0; r < NB; r++) if (this.bldRows[r].length) { dirty.add(r); this.bldRows[r] = []; }
      for (const { row, obj } of this.buildingObjs(rt)) {
        this.bldRows[row].push(obj); dirty.add(row);
        for (const sp of obj.sprites) { this.rowCont[row].addChild(sp); this.bldSpr.push(sp); }
      }
    }
    for (const r of dirty) this.rows[r] = [...this.nodeRows[r], ...this.bldRows[r]];
  }

  /** Відсікання: шари глибини (смуги по y), що не потрапляють у видиму область екрана, не малюються. */
  private cull(): void {
    const top = screenToPlane(0, 0, this.cam).y, bot = screenToPlane(0, this.app.screen.height, this.cam).y;
    const margin = 70 / ISO_Y; // висота дерев і будівель зсуває малюнок угору
    const y0 = top - margin, y1 = bot + margin, rowH = BUCKET * TILE;
    for (let r = 0; r < NB; r++) {
      const vis = (r + 1) * rowH >= y0 && r * rowH <= y1;
      this.rowCont[r].visible = vis;
    }
  }

  private draw = (): void => {
    this.simulate();
    this.surroundings.update(this.cam, this.app.screen.width, this.app.screen.height);
    this.cull();
    const dt = Math.min(0.05, this.app.ticker.deltaMS / 1000);
    if (this.speed > 0) this.animT += dt;
    this.drawNpcs(dt);
    this.atmo.update(dt);
    this.parts.update(dt);
    this.updateFalling(dt);
    this.emitAmbient(dt);
    this.drawShine();
    this.followCam();
    this.hoverG.clear();
    if (!(this.selected && this.hover)) this.ghost.hide();
    if (this.selected && this.hover) {
      const t = this.anchor(this.hover), fp = FOOTPRINT[this.selected];
      const ok = !fp || checkPlace(this.w, this.sector, this.selected, t.x, t.y) === null;
      if (fp) {
        const bk = Math.min(NB - 1, Math.max(0, Math.floor((t.y + fp.h - 1) / BUCKET)));
        this.ghost.show(this.root, this.ground, this.rowCont[bk], bk, t, fp, TILE, this.selected, ok);
      }
    }
    if (this.hoverSel && !(this.sel && JSON.stringify(this.sel) === JSON.stringify(this.hoverSel))) this.frame_(this.hoverSel, 0xffffff, 0.5);
    if (this.sel) this.frame_(this.sel, 0xffd54f, 1);
    if (this.forceRebuild) { this.forceRebuild = false; this.rebuild(); }
    if (++this.frame % 20 === 0) {
      if (this.signature() !== this.lastSig) this.rebuild();
      this.refreshHud();
    }
  };


  /** Жителі: спрайти з пулу; кадр — ходьба (за відстанню), дія (за часом) або спокій. Ноги й тіло — один кадр, тож не розходяться. */
  private drawNpcs(dt: number): void {
    const n = this.w.state.npcs, npc = this.w.npc, alpha = this.clock.alpha(performance.now());
    const seen = new Set<number>();
    const zoomOk = this.cam.zoom > 0.45;
    for (let i = 0; i < n.capacity; i++) {
      if (!n.alive[i] || n.sector[i] !== this.sector) continue;
      seen.add(i);
      const tx = lerpPos(npc.px[i], n.x[i], alpha), ty = lerpPos(npc.py[i], n.y[i], alpha);
      const px = tx * TILE, py = ty * TILE, row = Math.min(NB - 1, Math.max(0, Math.floor(ty / BUCKET)));
      let v = this.npcVis.get(i);
      if (!v) {
        const s = new Sprite(spr(frameId('civ', 'idle', 0)).tex), c = new Sprite(spr('bundle_wood').tex);
        s.anchor.set(0.5); c.anchor.set(0.5, 1);
        v = { s, carry: c, lx: px, ly: py, dist: i * 3.7, dir: 1, frame: -1, row: -1 };
        this.npcVis.set(i, v);
      }
      const moved = Math.hypot(px - v.lx, py - v.ly);
      if (Math.abs(px - v.lx) > 0.05) v.dir = px > v.lx ? 1 : -1;
      v.lx = px; v.ly = py; v.dist += moved;
      const cls = classOf(PROFESSIONS[n.profession[i]] ?? 'idle'), tool = toolOf(cls);
      const working = n.task[i] === WORK_TASK && moved < 0.05, walking = !working && moved > 0.02;
      let anim: 'idle' | 'walk' | 'act', fi: number;
      if (working && actFrames(tool)) { anim = 'act'; fi = cycleFrame(this.animT + i * 0.37, actRate(tool), actFrames(tool)); }
      else if (walking) { anim = 'walk'; fi = walkFrame(v.dist); }
      else { anim = 'idle'; fi = cycleFrame(this.animT + i * 0.61, 0.6, IDLE_FRAMES); }
      const key = (anim === 'act' ? 200 : anim === 'walk' ? 100 : 0) + fi + (cls.length * 1000);
      const a = spr(frameId(cls, anim, fi));
      if (v.frame !== key) {
        v.s.texture = a.tex; v.s.anchor.set(a.ax / a.w, a.ay / a.h);
        if (anim === 'act' && fi === hitFrame(tool) && zoomOk) this.emitHit(tool, px, py, v.dir);
        v.frame = key;
      }
      const small = n.stats[i * NPC_STAT_COUNT + SIZE_STAT] < 2 ? 0.82 : 1;
      v.s.scale.set(a.scale * small * v.dir, a.scale * small);
      const base = planeToIso(px, py, 0);
      v.s.position.set(base.x, base.y); v.s.zIndex = py;
      if (v.row !== row) { this.rowCont[row].addChild(v.s, v.carry); v.row = row; }
      if (walking && zoomOk && Math.random() < dt * 4) this.parts.emit({ x: px, y: py, z: 0.5, vx: (Math.random() - 0.5) * 6, vz: 4, g: 8, life: 0.45, col: 0xc9b48a, size: 0.7, a: 0.5, kind: 'dust' });
      // ноша над головою: колоди/камінь/дошки/їжа; оброблене дерево — дошки
      if (n.carryAmount[i]) {
        const kind = RESOURCE_KINDS[n.carryKind[i]] ?? 'wood', done = npc.stage[i] === 1;
        const id = `bundle_${RES_BUNDLE[done && kind === 'wood' ? 'planks' : kind] ?? 'sack'}`, b = spr(id), lvl = n.carryAmount[i] >= 4 ? 1.5 : n.carryAmount[i] >= 2 ? 1.25 : 1;
        v.carry.texture = b.tex; v.carry.scale.set(b.scale * lvl * small); v.carry.visible = true;
        v.carry.position.set(base.x, base.y - 21 * a.scale * small); v.carry.zIndex = py + 0.01;
      } else v.carry.visible = false;
    }
    for (const [i, v] of this.npcVis) if (!seen.has(i)) { v.s.destroy(); v.carry.destroy(); this.npcVis.delete(i); }
  }

  private falling: Falling[] = [];
  private forceRebuild = false;

  /** Дерево зрубано: на його місці одразу пеньок, а зрубане падає від лісоруба (хитання, падіння, удар об землю з листям і пилом). */
  private fellTree(cell: number, fx: number, fy: number): void {
    const cx = cell % SECTOR_CELLS, cy = (cell / SECTOR_CELLS) | 0;
    this.forceRebuild = true;
    if (this.cam.zoom < 0.25) return;
    const nt = nodeTile(this.w.state.world.seed, this.sector, cx, cy);
    const id = treeSpriteId(cx, cy, OAK_VARIANTS, PINE_VARIANTS), a = spr(id), s = new Sprite(a.tex);
    const px = (nt.x + 0.5) * TILE, py = (nt.y + 0.5) * TILE, base = planeToIso(px, py, 0);
    const flip = variant(cx, cy, 2, 5) === 1;
    s.anchor.set(a.ax / a.w, a.ay / a.h); s.scale.set(flip ? -a.scale : a.scale, a.scale); s.position.set(base.x, base.y); s.zIndex = py + 0.02;
    const vx = nt.x + 0.5 - fx, vy = nt.y + 0.5 - fy, len = Math.hypot(vx, vy) || 1;
    const sx = planeToIso(nt.x * TILE, nt.y * TILE, 0).x - planeToIso(fx * TILE, fy * TILE, 0).x;
    const row = Math.min(NB - 1, Math.max(0, Math.floor(nt.y / BUCKET)));
    this.rowCont[row].addChild(s);
    this.falling.push({ s, t: 0, dir: sx >= 0 ? 1 : -1, px, py, ux: vx / len, uy: vy / len, reach: a.ay * a.scale * 0.9, hit: false, row });
  }

  private updateFalling(dt: number): void {
    if (this.speed === 0) return;
    const P = this.parts, r = Math.random;
    for (let k = this.falling.length - 1; k >= 0; k--) {
      const f = this.falling[k];
      f.t += dt;
      const t = f.t;
      if (t < FELL_SHAKE) { // хитання перед падінням + листя з крони
        f.s.rotation = Math.sin(t * 60) * 0.035 * (t / FELL_SHAKE);
        if (r() < dt * 30) P.emit({ x: f.px, y: f.py, z: 14 + r() * 6, vx: (r() - 0.5) * 8, vz: 2, g: 20, life: 0.8, col: r() < 0.5 ? 0x5d7a45 : 0x2c4638, size: 0.7 });
      } else if (t < FELL_SHAKE + FELL_FALL) { // падіння: прискорення (t²), легке відскакування наприкінці
        const u = (t - FELL_SHAKE) / FELL_FALL, ease = u * u;
        f.s.rotation = f.dir * ease * (Math.PI / 2 - 0.08);
        if (r() < dt * 25) P.emit({ x: f.px + f.ux * f.reach * ease * 0.5, y: f.py + f.uy * f.reach * ease * 0.5, z: 8 * (1 - ease) + 3, vx: f.ux * 4, vy: f.uy * 4, vz: 1, g: 25, life: 0.7, col: 0x5d7a45, size: 0.7 });
      } else {
        const u = (t - FELL_SHAKE - FELL_FALL) / FELL_FADE;
        if (!f.hit) { // удар об землю: пил і листя, дерево трохи підскакує
          f.hit = true;
          for (let j = 0; j < 14; j++) P.emit({ x: f.px + f.ux * f.reach * 0.9, y: f.py + f.uy * f.reach * 0.9, z: 1, vx: (r() - 0.5) * 22, vy: (r() - 0.5) * 12, vz: 6 + r() * 8, g: 40, life: 0.8, col: j % 2 ? 0xc9b48a : 0x5d7a45, size: 0.9, kind: j % 2 ? 'dust' : 'chip', a: 0.7 });
        }
        f.s.rotation = f.dir * (Math.PI / 2 - 0.08 - Math.max(0, 0.12 * Math.sin(Math.min(1, u * 3) * Math.PI)));
        f.s.alpha = Math.max(0, 1 - Math.max(0, u - 0.3) / 0.7);
        if (u >= 1) { f.s.destroy(); this.falling.splice(k, 1); }
      }
    }
  }

  /** Удар інструмента: тріски, іскри, пил, стріла. */
  private emitHit(tool: Tool, px: number, py: number, dir: number): void {
    const P = this.parts, r = Math.random;
    const burst = (n: number, o: (k: number) => Parameters<Particles['emit']>[0]) => { for (let k = 0; k < n; k++) P.emit(o(k)); };
    if (tool === 'axe') burst(7, (k) => ({ x: px + dir * 5, y: py, z: 5, vx: dir * (6 + r() * 12), vz: 12 + r() * 14, g: 90, life: 0.6, col: k % 2 ? 0xd9b27a : 0x8a6238, size: 0.6 }));
    else if (tool === 'pick') burst(6, () => ({ x: px + dir * 5, y: py, z: 3, vx: dir * (4 + r() * 14), vz: 8 + r() * 14, g: 80, life: 0.35, col: 0xffe08a, size: 0.6, kind: 'spark' }));
    else if (tool === 'hammer' || tool === 'sword') burst(4, () => ({ x: px + dir * 5, y: py, z: 3, vx: dir * (4 + r() * 10), vz: 8 + r() * 10, g: 70, life: 0.35, col: 0xffe08a, size: 0.6, kind: 'spark' }));
    else if (tool === 'hoe') burst(5, () => ({ x: px + dir * 6, y: py, z: 1, vx: dir * (3 + r() * 6), vz: 5 + r() * 6, g: 40, life: 0.5, col: 0x8a6a3e, size: 0.7 }));
    else if (tool === 'bow') P.emit({ x: px + dir * 3, y: py + 0.01, z: 6, vx: dir * 150, vz: 7, g: 40, life: 0.55, col: 0xe6dcc0, size: 1, kind: 'arrow' });
  }

  /** Дим із димарів і похідних вогнищ (лише у видимій частині екрана). */
  private emitAmbient(dt: number): void {
    const w = this.app.screen.width, h = this.app.screen.height;
    for (const m of this.smokers) {
      if (Math.random() > dt * 1.2) continue;
      const q = planeToIso(m.x, m.y, m.z), sx = q.x * this.cam.zoom + this.cam.x, sy = q.y * this.cam.zoom + this.cam.y;
      if (sx < -50 || sx > w + 50 || sy < -80 || sy > h + 50) continue;
      this.parts.emit({ x: m.x, y: m.y, z: m.z, vx: 2 + Math.random() * 2, vz: 5 + Math.random() * 3, life: 3, col: 0x9a96a0, size: 1.2, a: 0.4, kind: 'smoke' });
    }
  }

  /** Камера слідує за виділеним (м'яко): об'єкт у центрі екрана, зум плавно наближається. */
  private cmd(cmd: Parameters<typeof applyCommand>[1]['cmd']) {
    return applyCommand(this.w, { player: this.player, seq: 0, cmd });
  }
  /** «+»: посадити найближчого вільного жителя; немає вільних — вмикаємо вибір зі списку робітників (можна перетягнути із чужої роботи). */
  private addWorker(id: number): void {
    const b = this.w.byId.get(id);
    if (!b) return;
    const max = MAX_WORKERS[b.kind] ?? 0;
    if (slotsOf(b) >= max) { this.hud.say('Це максимум працівників для цієї споруди'); return; }
    this.cmd({ type: 'set_worker_count', building: id, count: slotsOf(b) + 1 }); // вільний місце займає автопризначення
    if (b.workers.length < slotsOf(b) && !idleNpcs(this.w, this.player).length) {
      this.hud.say('Вільних жителів немає: обери робітника зі списку, щоб перевести його сюди');
      this.hud.openTab('people'); this.hud.assignTarget = id;
    }
    this.refreshHud();
  }
  private assignTo(npc: number, id: number): void {
    const b = this.w.byId.get(id), job = b && JOB_OF[b.kind];
    if (!b || !job) return;
    const r = this.cmd({ type: 'assign_worker', npc, profession: job, building: id });
    this.hud.say(r.ok ? 'Призначено' : r.reason === 'occupied' ? 'У споруді немає вільних місць' : 'Не можна призначити');
    this.refreshHud();
  }

  /** Гравець змінив швидкість (кнопка/клавіша); у мережевій грі гість не керує — лише хост. */
  private userSpeed(v: number): void {
    if (this.net.locked || !isSpeed(v)) return;
    this.setSpeed(v);
    this.net.onSpeed?.(v);
  }
  /** Застосувати швидкість (також ззовні: хост змінив). */
  setSpeed(v: number): void {
    if (!isSpeed(v)) return;
    if (v > 0) this.resumeSpeed = v;
    this.speed = v;
    this.refreshHud();
  }
  /** Кадр симуляції: стільки тіків, скільки належить швидкості, у межах бюджету часу кадру. */
  private simulate(): void {
    this.pacer.advance(this.app.ticker.deltaMS, this.speed, () => {
      stepWorld(this.w);
      this.clock.tick(performance.now());
      for (const e of this.w.events) {
        if (e.e === 'trail_stage_changed') this.groundDirty = true;
        else if (e.e === 'tree_felled' && e.sector === this.sector) this.fellTree(e.cell, e.fx, e.fy);
      }
    });
  }

  private followCam(): void {
    if (!this.sel) return;
    const pos = this.posOf(this.sel);
    if (!pos) { this.deselect(); return; }
    if (!this.following) return;
    const z = this.cam.zoom + (this.targetZoom - this.cam.zoom) * 0.2;
    const iso = planeToIso(pos.x * TILE, pos.y * TILE, 4);
    this.cam = { zoom: z, x: this.app.screen.width / 2 - iso.x * z, y: this.app.screen.height / 2 - iso.y * z };
    this.applyCam();
  }

  /** Рамка виділення: кільце навколо жителя, контур footprint для споруди, овал для ресурсу, тайл для дороги. */
  private frame_(sel: Sel, color: number, alpha: number): void {
    const pos = this.posOf(sel);
    if (!pos) return;
    const g = this.hoverG, st = { width: 2, color, alpha };
    if (sel.t === 'group') { for (const i of sel.items.slice(0, 200)) this.frame_(i, color, alpha); return; }
    if (sel.t === 'npc') {
      const c = planeToIso(pos.x * TILE, pos.y * TILE, 0), hw = (NPC_TILES * TILE) / 2;
      g.ellipse(c.x, c.y, hw * 1.7, hw * 0.85).stroke(st);
    } else if (sel.t === 'building') {
      const b = this.w.byId.get(sel.id)!;
      g.poly(this.quad(b.cell.x - 0.5, b.cell.y - 0.5, b.size.w + 1, b.size.h + 1)).fill({ color, alpha: 0.12 * alpha }).stroke(st);
    } else if (sel.t === 'node') {
      const c = planeToIso(pos.x * TILE, pos.y * TILE, 0), r = (STONE_TILES * TILE) / 2;
      g.ellipse(c.x, c.y, r, r * 0.5).stroke(st);
    } else g.poly(this.quad(sel.x, sel.y, 1, 1)).fill({ color, alpha: 0.3 * alpha }).stroke(st);
  }

  /** Дешева сигнатура видимого стану (вузли зрубано/виросло, кількість будівель): без змін — шари не перебудовуємо. */
  private lastSig = '';
  private signature(): string {
    const rt = getSectorRt(this.w, this.sector);
    let h = 0, grown = 0;
    for (let i = 0; i < rt.kind.length; i++) if (rt.kind[i] && rt.amount[i] > 0) { grown += rt.amount[i]; h = (h * 31 + i * (rt.amount[i] + 1)) | 0; }
    return `${grown}:${h}:${rt.buildings.length}`;
  }

  /** Для автотестів: стан вибору й екранні координати об'єктів. */
  debugState(): { build: BuildingKind | null; sel: Sel | null; following: boolean; ghost: boolean; layers: { ground: number; base: number; ghost: number; hover: number }; speed: number; tick: number; zoom: number; npcs: { id: number; sx: number; sy: number }[]; time: string; lights: number; particles: number; falling: number; npcSprites: number; buildings: { id: number; kind: string; sx: number; sy: number }[] } {
    const scr = (x: number, y: number, z: number) => { const i = planeToIso(x * TILE, y * TILE, z); return { sx: i.x * this.cam.zoom + this.cam.x, sy: i.y * this.cam.zoom + this.cam.y }; };
    const n = this.w.state.npcs, npcs: { id: number; sx: number; sy: number }[] = [];
    for (let i = 0; i < n.capacity; i++) if (n.alive[i] && n.sector[i] === this.sector) npcs.push({ id: i, ...scr(this.npcXY(i).x, this.npcXY(i).y, 3) });
    const buildings = this.w.state.buildings.map((b) => ({ id: b.id, kind: b.kind, ...scr(b.cell.x + b.size.w / 2, b.cell.y + b.size.h / 2, 6) }));
    return { build: this.selected, sel: this.sel, following: this.following, ghost: this.ghost.g.visible && !!this.ghost.g.parent,
      layers: { ground: this.root.getChildIndex(this.ground), base: this.ghost.base.parent ? this.root.getChildIndex(this.ghost.base) : -1, ghost: this.ghost.g.parent ? this.root.getChildIndex(this.ghost.g) : -1, hover: this.root.getChildIndex(this.hoverG) }, speed: this.speed, tick: this.w.state.tick, zoom: this.cam.zoom, npcs, time: this.atmo.key, lights: this.atmo.lightCount, particles: this.parts.count, falling: this.falling.length, npcSprites: this.npcVis.size, buildings };
  }

  destroy(): void {
    this.app.ticker.remove(this.draw);
    this.app.canvas.removeEventListener('pointermove', this.move);
    this.app.canvas.removeEventListener('pointerdown', this.down);
    this.app.canvas.removeEventListener('pointerup', this.up);
    this.app.canvas.removeEventListener('wheel', this.wheel);
    this.app.canvas.removeEventListener('contextmenu', this.noMenu);
    window.removeEventListener('keydown', this.key);
    this.app.canvas.style.cursor = '';
    this.app.renderer.off('resize', this.onResize);
    this.app.stage.removeChild(this.root, this.atmo.multiply, this.atmo.lights, this.atmo.top);
    this.atmo.multiply.destroy(); this.atmo.lights.destroy({ children: true }); this.atmo.top.destroy({ children: true });
    this.falling = [];
    this.root.destroy({ children: true });
    this.boxEl.remove();
    this.hud.destroy();
  }
}
