import { Application, Container, Graphics } from 'pixi.js';
import type { BuildingKind } from '../shared';
import { ACTIVE_MAX_TILE, ACTIVE_MIN_TILE, SECTOR_CELLS, SECTOR_SIZE, TRAIL_BRUSH_TILES, isActiveCell } from '../shared';
import { genBorderNode, mixNodeSeed } from '../sim/nodegen';
import {
  applyCommand, checkPlace, getSectorRt, idleNpcs, slotsOf, nodeTile, staffBuilding, stepWorld, NODE_TREE, type SimWorld,
} from '../sim';
import { FOOTPRINT, JOB_OF, MAX_WORKERS, NPC_TILES, STONE_TILES, TREE_TILES } from '../sim/balance';
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
/** Висота будівель (одиниці площини); ширина/глибина — з footprint у тайлах. */
const BUILD_H: Record<string, number> = { townhall: 30, warehouse: 18, lumberjack: 16, quarry: 14, sawmill: 22, farm: 10, house: 18 };
// Шар глибини = один ряд клітинок (BUCKET = TILES_PER_CELL тайлів): вузол клітинки cy завжди лягає в шар cy,
// тож зміну вузлів у рядку можна перемалювати одним шаром.
const NB = SECTOR_CELLS;
const BUCKET = SECTOR_SIZE / NB;

const STAGE_COLORS = [0, 0x5a4a30, 0x8a7448, 0xb8b0a0];
const BUILD_COLORS: Record<string, number> = {
  townhall: 0xffd54f, warehouse: 0xc19a6b, lumberjack: 0x2e7d32, quarry: 0x9e9e9e, sawmill: 0xd7a86e, farm: 0xc0ca33, house: 0xe57373,
};
const lighten = (c: number): number => {
  const f = (v: number) => Math.min(255, Math.round(v + (255 - v) * 0.25));
  return (f((c >> 16) & 255) << 16) | (f((c >> 8) & 255) << 8) | f(c & 255);
};
const PROF_COLORS = [0xeeeeee, 0x66bb6a, 0xbdbdbd, 0x90caf9, 0xff8a65, 0xba68c8, 0xffcc80, 0xaed581];

interface Obj { draw: (g: Graphics) => void; pick: number[] | null; tile: { x: number; y: number } | null; sel: Sel | null }
type Tile = { x: number; y: number };

/** Вигляд міста одного сектора в тій самій ізометрії, що й карта: тайли, пан, зум, малювання за глибиною, пікінг за порядком малювання. */
export class CityView {
  private root = new Container();
  private ground = new Graphics();
  private rowObj: Graphics[] = [];
  private rowNpc: Graphics[] = [];
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
  private drag: { x: number; y: number; moved: boolean; button: number } | null = null;
  private rows: Obj[][] = Array.from({ length: NB }, () => []);
  private groundDirty = true;

  constructor(private app: Application, private w: SimWorld, private player: string, private sector: number, private onExit: () => void,
    private net: { locked?: boolean; speed?: number; onSpeed?: (s: number) => void } = {}) {
    if (isSpeed(net.speed)) this.speed = net.speed;
    // Сусідні сектори (ландшафт): ряд над домашнім і по боках — під землею, ряд під ним — поверх шарів.
    this.surroundings = new Surroundings(app.renderer, w.state.world.seed, w.state.sectors[sector]);
    this.root.addChild(this.surroundings.back);
    this.root.addChild(this.ground);
    this.drawWater();
    for (let r = 0; r < NB; r++) {
      const o = new Graphics(), n = new Graphics();
      this.rowObj.push(o); this.rowNpc.push(n);
      this.root.addChild(o, n);
    }
    this.root.addChild(this.surroundings.front);
    this.drawFog();
    this.root.addChild(this.hoverG);
    app.stage.addChild(this.root);
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
  }

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

  /** Що під курсором у режимі «вибір»: житель, потім споруда/дерево/камінь (за порядком малювання), потім дорога. */
  private pickSel(e: PointerEvent): Sel | null {
    const z = this.cam.zoom, pad = 4 / z;
    const p = { x: (e.clientX - this.cam.x) / z, y: (e.clientY - this.cam.y) / z };
    const n = this.w.state.npcs, hw = (NPC_TILES * TILE) / 2;
    let best = -1, by = -Infinity;
    for (let i = 0; i < n.capacity; i++) {
      if (!n.alive[i] || n.sector[i] !== this.sector) continue;
      const q = this.npcXY(i), px = q.x * TILE, py = q.y * TILE;
      const body = planeToIso(px, py, hw * 1.6), base = planeToIso(px, py, 0);
      if (Math.abs(p.x - body.x) <= hw + pad && p.y >= body.y - hw * 0.4 - pad && p.y <= base.y + hw * 0.4 + pad && base.y > by) { best = i; by = base.y; }
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
    const p = selPos(this.w, this.sector, sel);
    return p && sel.t === 'npc' ? this.npcXY(sel.id) : p;
  }

  private noMenu = (e: Event): void => e.preventDefault();
  /** Esc: скасувати будівництво, інакше зняти виділення. */
  private key = (e: KeyboardEvent): void => {
    if (e.code === 'Space') { e.preventDefault(); this.userSpeed(this.speed ? 0 : this.resumeSpeed); return; }
    const d = /^Digit([1-5])$/.exec(e.code); // 1..5 -> 1×, 2×, 5×, 10×, 100×
    if (d) { this.userSpeed(SPEEDS[Number(d[1])]); return; }
    if (e.key !== 'Escape') return;
    if (this.selected) this.setBuild(null); else if (this.sel) this.deselect();
  };

  private move = (e: PointerEvent): void => {
    if (this.drag && this.drag.button !== 2) {
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      if (this.drag.moved || Math.abs(dx) + Math.abs(dy) > 4) {
        if (!this.drag.moved && this.following) { this.following = false; this.refreshHud(); } // ручний пан знімає стеження
        this.drag.moved = true; this.cam.x += dx; this.cam.y += dy;
        this.drag.x = e.clientX; this.drag.y = e.clientY; this.applyCam();
      }
    }
    if (this.selected) { this.hover = this.pickTile(e); this.hoverSel = null; this.app.canvas.style.cursor = 'crosshair'; }
    else {
      this.hover = null;
      this.hoverSel = this.drag?.moved ? null : this.pickSel(e);
      this.app.canvas.style.cursor = this.hoverSel ? 'pointer' : 'default';
    }
  };
  private down = (e: PointerEvent): void => { this.drag = { x: e.clientX, y: e.clientY, moved: false, button: e.button }; };
  private up = (e: PointerEvent): void => {
    const d = this.drag; this.drag = null;
    if (!d || d.moved) return;
    if (d.button === 2) { // ПКМ: скасувати будівництво або виділення
      if (this.selected) this.setBuild(null); else this.deselect();
      return;
    }
    if (d.button !== 0) return;
    if (!this.selected) { // режим «вибір»
      const s = this.pickSel(e);
      if (s) this.select(s, false); else this.deselect();
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

  /** Земля й стежки: «пензель» шириною за стадією (стежка вузька, вимощена дорога широка). */
  /** Вода: світла берегова смуга + темніша глибина (тайли, всі сусіди яких теж вода); горизонтальні серії зливаємо в один прямокутник. */
  private drawWater(): void {
    const rt = getSectorRt(this.w, this.sector), g = new Graphics(), T = SECTOR_SIZE, wt = rt.water;
    const runs = (deep: boolean, color: number, alpha: number) => {
      for (let y = ACTIVE_MIN_TILE; y < ACTIVE_MAX_TILE; y++) {
        let x0 = -1;
        for (let x = ACTIVE_MIN_TILE; x <= ACTIVE_MAX_TILE; x++) {
          const i = y * T + x;
          const on = x < ACTIVE_MAX_TILE && wt[i] === 1 && (!deep || (wt[i - 1] === 1 && wt[i + 1] === 1 && wt[i - T] === 1 && wt[i + T] === 1));
          if (on && x0 < 0) x0 = x;
          else if (!on && x0 >= 0) { g.poly(this.quad(x0, y, x - x0, 1)).fill({ color, alpha }); x0 = -1; }
        }
      }
    };
    runs(false, 0x8fd0e0, 0.9);
    runs(true, 0x2f78b0, 0.9);
    this.root.addChild(g);
  }

  /** Туман неактивної смуги: ступінчасте затемнення до краю карти (поверх лісу й каміння). */
  private drawFog(): void {
    const g = new Graphics(), A = ACTIVE_MIN_TILE, Z = ACTIVE_MAX_TILE, n = 8, step = A / n;
    const frame = (i0: number, i1: number, alpha: number) => { // кільце між відступами i0 < i1 тайлів від активного краю назовні
      const a0 = A - i0, b0 = Z + i0, a1 = A - i1, b1 = Z + i1;
      for (const q of [[a1, a1, b1 - a1, i1 - i0], [a1, b0, b1 - a1, i1 - i0], [a1, a0, i1 - i0, b0 - a0], [b0, a0, i1 - i0, b0 - a0]]) {
        g.poly(this.quad(q[0], q[1], q[2], q[3])).fill({ color: 0x0b1424, alpha });
      }
    };
    for (let k = 0; k < n; k++) frame(k * step, (k + 1) * step, 0.3 + 0.06 * k);
    this.root.addChild(g);
  }

  private rebuildGround(): void {
    const rt = getSectorRt(this.w, this.sector);
    const g = this.ground;
    g.clear();
    g.poly(this.quad(0, 0, SECTOR_SIZE, SECTOR_SIZE)).fill(0x2a3a22);
    for (let st = 1; st <= 3; st++) {
      const wd = TRAIL_BRUSH_TILES[st], off = (wd - 1) / 2;
      for (let i = 0; i < rt.stage.length; i++) {
        if (rt.stage[i] !== st) continue;
        g.poly(this.quad((i % SECTOR_SIZE) - off, Math.floor(i / SECTOR_SIZE) - off, wd, wd)).fill(STAGE_COLORS[st]);
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
    const nt = nodeTile(seed, this.sector, cx, cy), grown = border || rt.amount[i] > 0;
    const px = (nt.x + 0.5) * TILE, py = (nt.y + 0.5) * TILE, tile = { x: nt.x, y: nt.y };
    const base = planeToIso(px, py, 0);
    const row = Math.min(NB - 1, Math.max(0, Math.floor(nt.y / BUCKET)));
    if (kind === NODE_TREE) {
      const rad = (TREE_TILES * TILE) / 2, top = planeToIso(px, py, 22);
      return { row, obj: {
        tile, sel: grown ? { t: 'node', cx, cy } : null,
        pick: grown ? [top.x - rad, top.y - rad, top.x + rad, top.y - rad, base.x + rad / 2, base.y + 2, base.x - rad / 2, base.y + 2] : null,
        draw: (gr) => {
          if (!grown) { gr.ellipse(base.x, base.y, 3, 2).fill(0x5d4037); return; }
          const mid = planeToIso(px, py, 9);
          gr.rect(mid.x - 1.5, mid.y, 3, base.y - mid.y).fill(0x5d4037);
          gr.ellipse(top.x, top.y + 3, rad, rad * 1.25).fill(0x1b5e20);
        },
      } };
    }
    const rw = (STONE_TILES * TILE) / 2;
    return { row, obj: {
      tile, sel: { t: 'node', cx, cy },
      pick: [base.x - rw, base.y - rw * 0.9, base.x + rw, base.y - rw * 0.9, base.x + rw, base.y + 2, base.x - rw, base.y + 2],
      draw: (gr) => { gr.ellipse(base.x, base.y - (grown ? 3 : 1), grown ? rw : rw * 0.6, grown ? rw * 0.7 : rw * 0.35).fill(grown ? 0x78787f : 0x55555a); },
    } };
  }

  private buildingObjs(rt: ReturnType<typeof getSectorRt>): { row: number; obj: Obj }[] {
    const out: { row: number; obj: Obj }[] = [];
    for (const b of rt.buildings) {
      const h = BUILD_H[b.kind] ?? 16, col = BUILD_COLORS[b.kind] ?? 0xffffff;
      const x0 = b.cell.x * TILE, y0 = b.cell.y * TILE, bw = b.size.w * TILE, bh = b.size.h * TILE;
      const top = this.quad(b.cell.x, b.cell.y, b.size.w, b.size.h, h);
      const front = [planeToIso(x0, y0 + bh, h), planeToIso(x0 + bw, y0 + bh, h), planeToIso(x0 + bw, y0 + bh, 0), planeToIso(x0, y0 + bh, 0)].flatMap((v) => [v.x, v.y]);
      const pick = [top[0], top[1], top[2], top[3], front[4], front[5], front[6], front[7]]; // силует: верх + фасад
      out.push({ row: Math.min(NB - 1, Math.max(0, Math.floor((b.cell.y + b.size.h - 1) / BUCKET))), obj: {
        tile: b.cell, pick, sel: { t: 'building', id: b.id },
        draw: (gr) => {
          gr.poly(front).fill({ color: col }).stroke({ width: 1, color: 0x000000, alpha: 0.6 });
          gr.poly(top).fill({ color: lighten(col) }).stroke({ width: 1, color: 0x000000, alpha: 0.6 });
          const e = planeToIso((b.entrance.x + 0.5) * TILE, (b.entrance.y + 0.5) * TILE, 0);
          gr.ellipse(e.x, e.y, 3, 1.5).fill(0x000000);
        },
      } });
    }
    return out;
  }

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
      for (let cx = 0, i = cy * SECTOR_CELLS; cx < SECTOR_CELLS; cx++, i++) if (rt.kind[i]) h = (Math.imul(h, 31) + (rt.amount[i] > 0 ? i + 1 : -(i + 1))) | 0;
      if (h === this.rowSig[cy]) continue;
      this.rowSig[cy] = h;
      const objs: Obj[] = [];
      for (let cx = 0; cx < SECTOR_CELLS; cx++) { const n = this.nodeObj(rt, seed, cx, cy); if (n) objs.push(n.obj); }
      this.nodeRows[cy] = objs;
      dirty.add(cy);
    }
    const bsig = rt.buildings.map((b) => b.id).join(',');
    if (bsig !== this.bldSig) {
      this.bldSig = bsig;
      for (let r = 0; r < NB; r++) if (this.bldRows[r].length) { dirty.add(r); this.bldRows[r] = []; }
      for (const { row, obj } of this.buildingObjs(rt)) { this.bldRows[row].push(obj); dirty.add(row); }
    }
    for (const r of dirty) {
      this.rows[r] = [...this.nodeRows[r], ...this.bldRows[r]];
      const gr = this.rowObj[r];
      gr.clear();
      for (const o of this.rows[r]) o.draw(gr);
    }
  }

  /** Відсікання: шари глибини (смуги по y), що не потрапляють у видиму область екрана, не малюються. */
  private cull(): void {
    const top = screenToPlane(0, 0, this.cam).y, bot = screenToPlane(0, this.app.screen.height, this.cam).y;
    const margin = 70 / ISO_Y; // висота дерев і будівель зсуває малюнок угору
    const y0 = top - margin, y1 = bot + margin, rowH = BUCKET * TILE;
    for (let r = 0; r < NB; r++) {
      const vis = (r + 1) * rowH >= y0 && r * rowH <= y1;
      this.rowObj[r].visible = vis; this.rowNpc[r].visible = vis;
    }
  }

  private draw = (): void => {
    this.simulate();
    this.surroundings.update(this.cam, this.app.screen.width, this.app.screen.height);
    this.cull();
    const n = this.w.state.npcs;
    for (const g of this.rowNpc) g.clear();
    const hw = (NPC_TILES * TILE) / 2; // NPC ≈ 2×2 тайли (візуально), без жорсткої колізії
    const alpha = this.clock.alpha(performance.now()), npc = this.w.npc;
    for (let i = 0; i < n.capacity; i++) {
      if (!n.alive[i] || n.sector[i] !== this.sector) continue;
      // плавний рух: інтерполяція між позицією на початку тіка й поточною, без округлення до тайла
      const tx = lerpPos(npc.px[i], n.x[i], alpha), ty = lerpPos(npc.py[i], n.y[i], alpha);
      const px = tx * TILE, py = ty * TILE;
      const row = Math.min(NB - 1, Math.max(0, Math.floor(ty / BUCKET)));
      const base = planeToIso(px, py, 0), body = planeToIso(px, py, hw * 1.6);
      const g = this.rowNpc[row];
      g.ellipse(base.x, base.y, hw, hw * 0.5).fill({ color: 0x000000, alpha: 0.35 });
      if (n.carryAmount[i]) { // ноша над головою: по шматку на одиницю; світліший = оброблене
        const col = n.carryKind[i] === 1 ? 0x9e9e9e : 0x6d4c41, done = this.w.npc.stage[i] === 1;
        for (let k = 0; k < n.carryAmount[i]; k++) g.rect(body.x - 5 + k * 3.4, body.y - hw * 0.2 - 4, 3, 3).fill(done ? lighten(lighten(col)) : col).stroke({ width: 0.5, color: 0x000000 });
      }
      g.roundRect(body.x - hw * 0.8, body.y - hw * 0.2, hw * 1.6, hw * 2.2, hw * 0.6)
        .fill(n.carryAmount[i] ? 0xfff176 : PROF_COLORS[n.profession[i]] ?? 0xffffff);
    }
    this.followCam();
    this.hoverG.clear();
    if (!(this.selected && this.hover)) this.ghost.hide();
    if (this.selected && this.hover) {
      const t = this.anchor(this.hover), fp = FOOTPRINT[this.selected];
      const ok = !fp || checkPlace(this.w, this.sector, this.selected, t.x, t.y) === null;
      if (fp) {
        const bk = Math.min(NB - 1, Math.max(0, Math.floor((t.y + fp.h - 1) / BUCKET)));
        this.ghost.show(this.root, this.ground, this.rowNpc[bk], bk, t, fp, TILE, BUILD_H[this.selected] ?? 16, BUILD_COLORS[this.selected] ?? 0xffffff, ok);
      }
    }
    if (this.hoverSel && !(this.sel && JSON.stringify(this.sel) === JSON.stringify(this.hoverSel))) this.frame_(this.hoverSel, 0xffffff, 0.5);
    if (this.sel) this.frame_(this.sel, 0xffd54f, 1);
    if (++this.frame % 20 === 0) {
      if (this.signature() !== this.lastSig) this.rebuild();
      this.refreshHud();
    }
  };

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
      if (this.w.events.some((e) => e.e === 'trail_stage_changed')) this.groundDirty = true;
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
    for (let i = 0; i < rt.kind.length; i++) if (rt.kind[i] && rt.amount[i] > 0) { grown++; h = (h * 31 + i) | 0; }
    return `${grown}:${h}:${rt.buildings.length}`;
  }

  /** Для автотестів: стан вибору й екранні координати об'єктів. */
  debugState(): { build: BuildingKind | null; sel: Sel | null; following: boolean; ghost: boolean; layers: { ground: number; base: number; ghost: number; hover: number }; speed: number; tick: number; zoom: number; npcs: { id: number; sx: number; sy: number }[]; buildings: { id: number; kind: string; sx: number; sy: number }[] } {
    const scr = (x: number, y: number, z: number) => { const i = planeToIso(x * TILE, y * TILE, z); return { sx: i.x * this.cam.zoom + this.cam.x, sy: i.y * this.cam.zoom + this.cam.y }; };
    const n = this.w.state.npcs, npcs: { id: number; sx: number; sy: number }[] = [];
    for (let i = 0; i < n.capacity; i++) if (n.alive[i] && n.sector[i] === this.sector) npcs.push({ id: i, ...scr(this.npcXY(i).x, this.npcXY(i).y, 3) });
    const buildings = this.w.state.buildings.map((b) => ({ id: b.id, kind: b.kind, ...scr(b.cell.x + b.size.w / 2, b.cell.y + b.size.h / 2, 6) }));
    return { build: this.selected, sel: this.sel, following: this.following, ghost: this.ghost.g.visible && !!this.ghost.g.parent,
      layers: { ground: this.root.getChildIndex(this.ground), base: this.ghost.base.parent ? this.root.getChildIndex(this.ghost.base) : -1, ghost: this.ghost.g.parent ? this.root.getChildIndex(this.ghost.g) : -1, hover: this.root.getChildIndex(this.hoverG) }, speed: this.speed, tick: this.w.state.tick, zoom: this.cam.zoom, npcs, buildings };
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
    this.app.stage.removeChild(this.root);
    this.root.destroy({ children: true });
    this.hud.destroy();
  }
}
