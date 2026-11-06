import { Application, Container, Graphics } from 'pixi.js';
import type { BuildingKind } from '../shared';
import { SECTOR_CELLS, SECTOR_SIZE, TRAIL_BRUSH_TILES } from '../shared';
import {
  applyCommand, buildCheck, checkPlace, residents, getSectorRt, nodeTile, ratePerSec, staffBuilding, stepWorld, NODE_STONE, NODE_TREE, type SimWorld,
} from '../sim';
import { COSTS, FOOTPRINT, MAX_WORKERS, NPC_TILES, STONE_TILES, TREE_TILES } from '../sim/balance';
import { ISO_Y, clampCamToWorld, planeToIso, pointInPoly, screenToPlane, zoomAt, type Camera, type Vec2 } from './projection';
import { Surroundings } from './surroundings';
import { lerpPos, TickClock } from './interp';

/** Розмір ТАЙЛА в одиницях площини (та сама проєкція, що й у карти): сектор = SECTOR_SIZE тайлів ≈ 1024 одиниці. */
const TILE = 4;
/** Висота будівель (одиниці площини); ширина/глибина — з footprint у тайлах. */
const BUILD_H: Record<string, number> = { townhall: 30, warehouse: 18, lumberjack: 16, quarry: 14, sawmill: 22, house: 18 };
const NB = 256; // шарів глибини на сектор (стала кількість Graphics незалежно від розміру сектора)
const BUCKET = SECTOR_SIZE / NB; // тайлів на шар глибини

const STAGE_COLORS = [0, 0x5a4a30, 0x8a7448, 0xb8b0a0];
const BUILD_COLORS: Record<string, number> = {
  townhall: 0xffd54f, warehouse: 0xc19a6b, lumberjack: 0x2e7d32, quarry: 0x9e9e9e, sawmill: 0xd7a86e, house: 0xe57373,
};
const BUILD_NAMES: Partial<Record<BuildingKind, string>> = {
  warehouse: 'Склад', lumberjack: 'Лісоруб', quarry: 'Кар’єр', sawmill: 'Лісопильня', house: 'Будинок',
};
const RES_NAMES: Record<string, string> = { wood: 'Дерево', stone: 'Камінь', planks: 'Дошки' };
const lighten = (c: number): number => {
  const f = (v: number) => Math.min(255, Math.round(v + (255 - v) * 0.25));
  return (f((c >> 16) & 255) << 16) | (f((c >> 8) & 255) << 8) | f(c & 255);
};
const WHY: Record<string, string> = {
  no_node: 'немає дерев/каменю в секторі', no_storage: 'немає куди віднести (склад?)', storage_full: 'склад повний',
  no_wood: 'немає вільного дерева (резерв під будівництво)', no_path: 'немає шляху', paused: 'на паузі',
};
const STATE_TXT: Record<string, string> = {
  free: 'вільний', to_node: 'іде до дерева/каменю', working: 'рубає/добуває', to_home: 'несе колоди до хатинки', processing: 'обтесує', carrying: 'несе готове', to_storage_take: 'іде по колоди',
  to_mill: 'несе колоди на пилораму', milling: 'пиляє', planning: 'обирає ціль', waiting: 'чекає', no_path: 'немає шляху',
};
const PROF_TXT: Record<string, string> = {
  idle: 'без роботи', lumberjack: 'лісоруб', miner: 'каменяр', sawyer: 'пильщик', carrier: 'носій', smith: 'коваль', hero: 'герой',
};
const PROF_COLORS = [0xeeeeee, 0x66bb6a, 0xbdbdbd, 0x90caf9, 0xff8a65, 0xba68c8, 0xffcc80];

interface Obj { draw: (g: Graphics) => void; pick: number[] | null; tile: { x: number; y: number } | null }
type Tile = { x: number; y: number };

/** Вигляд міста одного сектора в тій самій ізометрії, що й карта: тайли, пан, зум, малювання за глибиною, пікінг за порядком малювання. */
export class CityView {
  private root = new Container();
  private ground = new Graphics();
  private rowObj: Graphics[] = [];
  private rowNpc: Graphics[] = [];
  private hoverG = new Graphics();
  private panel: HTMLDivElement;
  private selected: BuildingKind | null = 'lumberjack';
  private timer: number | undefined;
  private frame = 0;
  private hover: Tile | null = null;
  private cam: Camera;
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private rows: Obj[][] = [];
  private groundDirty = true;
  private flowRows = new Map<number, { row: HTMLElement; text: HTMLElement; btn: HTMLButtonElement | null }>();
  private flowTitle: HTMLElement | null = null;

  constructor(private app: Application, private w: SimWorld, private player: string, private sector: number, private onExit: () => void) {
    // Сусідні сектори (ландшафт): ряд над домашнім і по боках — під землею, ряд під ним — поверх шарів.
    this.surroundings = new Surroundings(app.renderer, w.state.world.seed, w.state.sectors[sector], (dx, dy) => this.neighbourSector(dx, dy));
    this.root.addChild(this.surroundings.back);
    this.root.addChild(this.ground);
    for (let r = 0; r < NB; r++) {
      const o = new Graphics(), n = new Graphics();
      this.rowObj.push(o); this.rowNpc.push(n);
      this.root.addChild(o, n);
    }
    this.root.addChild(this.surroundings.front);
    this.root.addChild(this.hoverG);
    app.stage.addChild(this.root);
    const mid = planeToIso((SECTOR_SIZE * TILE) / 2, (SECTOR_SIZE * TILE) / 2);
    this.cam = { zoom: 1, x: app.screen.width / 2 - mid.x, y: app.screen.height / 2 - mid.y };
    this.applyCam();
    this.panel = document.createElement('div');
    this.panel.id = 'cityPanel';
    document.body.appendChild(this.panel);
    this.buildPanel();
    const el = app.canvas;
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('wheel', this.wheel, { passive: false });
    app.ticker.add(this.draw);
    this.timer = window.setInterval(() => {
      stepWorld(this.w);
      this.clock.tick(performance.now());
      if (this.w.events.some((e) => e.e === 'trail_stage_changed')) this.groundDirty = true;
    }, 100);
    this.rebuild();
  }

  private clock = new TickClock();
  private surroundings: Surroundings;
  /** Багатство сусіднього сектора: сусідній гекс карти за напрямом (або домашній, якщо гекса немає). */
  private neighbourSector(dx: number, dy: number) {
    const secs = this.w.state.sectors, home = secs[this.sector];
    const hit = secs.find((s) => s.hex.q === home.hex.q + dx && s.hex.r === home.hex.r + dy);
    return hit ?? home;
  }

  private applyCam(): void {
    this.cam = clampCamToWorld(this.cam, this.app.screen.width, this.app.screen.height, Surroundings.bounds());
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
  private move = (e: PointerEvent): void => {
    if (this.drag) {
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      if (this.drag.moved || Math.abs(dx) + Math.abs(dy) > 4) {
        this.drag.moved = true; this.cam.x += dx; this.cam.y += dy;
        this.drag.x = e.clientX; this.drag.y = e.clientY; this.applyCam();
      }
    }
    this.hover = this.pickTile(e);
  };
  private down = (e: PointerEvent): void => { this.drag = { x: e.clientX, y: e.clientY, moved: false }; };
  private up = (e: PointerEvent): void => {
    const d = this.drag; this.drag = null;
    if (!d || d.moved) return;
    const t = this.pickTile(e);
    if (!t || !this.selected) return;
    const r = applyCommand(this.w, { player: this.player, seq: 0, cmd: { type: 'place_building', kind: this.selected, sector: this.sector, cell: this.anchor(t) } });
    const msg = this.panel.querySelector('#cityMsg')!;
    if (!r.ok) { msg.textContent = r.reason === 'no_resources' ? `Не вистачає: ${this.missingText(this.selected)}` : 'Тут не можна (зайнято, ліс/камінь поруч або край сектора)'; return; }
    const b = this.w.state.buildings[this.w.state.buildings.length - 1];
    const n = staffBuilding(this.w, this.player, b.id);
    msg.textContent = n ? `Побудовано, працівників: ${n}` : MAX_WORKERS[b.kind] ? 'Побудовано, немає вільних працівників' : 'Побудовано';
    this.rebuild();
  };
  private wheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.cam = zoomAt(this.cam, e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
    this.applyCam();
  };

  private missingText(k: BuildingKind): string {
    const m = buildCheck(this.w, this.player, k).missing;
    return Object.entries(m).map(([r, v]) => `${v} ${RES_NAMES[r]?.toLowerCase() ?? r}`).join(', ');
  }

  private buildPanel(): void {
    const btns = (Object.keys(BUILD_NAMES) as BuildingKind[]).map((k) => {
      const cost = Object.entries(COSTS[k] ?? {}).map(([r, v]) => `${v} ${RES_NAMES[r]?.toLowerCase()}`).join(', ');
      return `<button data-k="${k}">${BUILD_NAMES[k]} <small>(${cost})</small></button>`;
    }).join('');
    this.panel.innerHTML = `<h2>Місто</h2><div id="cityRes"></div><div class="btns">${btns}</div>` +
      `<div id="cityMsg">Обери будівлю й клікни по землі</div><div id="cityFlow"></div><details id="cityPeople"><summary id="cityPeopleSum">Жителі</summary><pre id="cityPeopleList"></pre></details><button id="cityBack">← До карти</button>`;
    this.panel.querySelectorAll<HTMLButtonElement>('button[data-k]').forEach((b) => {
      b.onclick = () => { this.selected = b.dataset.k as BuildingKind; this.markSel(); };
    });
    this.panel.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-pause]');
      if (!t) return;
      const b = this.w.byId.get(Number(t.dataset.pause));
      if (b) applyCommand(this.w, { player: this.player, seq: 0, cmd: { type: 'set_building_paused', building: b.id, paused: !b.paused } });
      this.updatePanel();
    });
    (this.panel.querySelector('#cityBack') as HTMLButtonElement).onclick = () => this.onExit();
    this.markSel();
  }
  private markSel(): void {
    this.panel.querySelectorAll<HTMLButtonElement>('button[data-k]').forEach((b) => b.classList.toggle('sel', b.dataset.k === this.selected));
  }

  /** Прямокутник у тайлах -> ізо-полігон (на висоті z). */
  private quad(tx: number, ty: number, tw: number, th: number, z = 0): number[] {
    const x = tx * TILE, y = ty * TILE, w = tw * TILE, h = th * TILE;
    return [planeToIso(x, y, z), planeToIso(x + w, y, z), planeToIso(x + w, y + h, z), planeToIso(x, y + h, z)].flatMap((v: Vec2) => [v.x, v.y]);
  }

  /** Земля й стежки: «пензель» шириною за стадією (стежка вузька, вимощена дорога широка). */
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

  /** Об'єкти (дерева, камінь, будівлі) по шарах глибини; висота й розмір — з footprint/розмірів у тайлах. */
  private rebuild(): void {
    const rt = getSectorRt(this.w, this.sector), seed = this.w.state.world.seed;
    if (this.groundDirty) this.rebuildGround();
    this.lastSig = this.signature();
    this.rows = Array.from({ length: NB }, () => []);
    const bucket = (ty: number) => Math.min(NB - 1, Math.max(0, Math.floor(ty / BUCKET)));
    for (let cy = 0; cy < SECTOR_CELLS; cy++) {
      for (let cx = 0; cx < SECTOR_CELLS; cx++) {
        const i = cy * SECTOR_CELLS + cx;
        const kind = rt.kind[i];
        if (!kind) continue;
        const nt = nodeTile(seed, this.sector, cx, cy), grown = rt.amount[i] > 0;
        const px = (nt.x + 0.5) * TILE, py = (nt.y + 0.5) * TILE, tile = { x: nt.x, y: nt.y };
        const base = planeToIso(px, py, 0);
        if (kind === NODE_TREE) {
          const rad = (TREE_TILES * TILE) / 2, top = planeToIso(px, py, 22);
          this.rows[bucket(nt.y)].push({
            tile,
            pick: grown ? [top.x - rad, top.y - rad, top.x + rad, top.y - rad, base.x + rad / 2, base.y + 2, base.x - rad / 2, base.y + 2] : null,
            draw: (gr) => {
              if (!grown) { gr.ellipse(base.x, base.y, 3, 2).fill(0x5d4037); return; }
              const mid = planeToIso(px, py, 9);
              gr.rect(mid.x - 1.5, mid.y, 3, base.y - mid.y).fill(0x5d4037);
              gr.ellipse(top.x, top.y + 3, rad, rad * 1.25).fill(0x1b5e20);
            },
          });
        } else if (kind === NODE_STONE) {
          const rw = (STONE_TILES * TILE) / 2;
          this.rows[bucket(nt.y)].push({
            tile, pick: null,
            draw: (gr) => { gr.ellipse(base.x, base.y - (grown ? 3 : 1), grown ? rw : rw * 0.6, grown ? rw * 0.7 : rw * 0.35).fill(grown ? 0x78787f : 0x55555a); },
          });
        }
      }
    }
    for (const b of rt.buildings) {
      const h = BUILD_H[b.kind] ?? 16, col = BUILD_COLORS[b.kind] ?? 0xffffff;
      const x0 = b.cell.x * TILE, y0 = b.cell.y * TILE, bw = b.size.w * TILE, bh = b.size.h * TILE;
      const top = this.quad(b.cell.x, b.cell.y, b.size.w, b.size.h, h);
      const front = [planeToIso(x0, y0 + bh, h), planeToIso(x0 + bw, y0 + bh, h), planeToIso(x0 + bw, y0 + bh, 0), planeToIso(x0, y0 + bh, 0)].flatMap((v) => [v.x, v.y]);
      const pick = [top[0], top[1], top[2], top[3], front[4], front[5], front[6], front[7]]; // силует: верх + фасад
      this.rows[bucket(b.cell.y + b.size.h - 1)].push({
        tile: b.cell, pick,
        draw: (gr) => {
          gr.poly(front).fill({ color: col }).stroke({ width: 1, color: 0x000000, alpha: 0.6 });
          gr.poly(top).fill({ color: lighten(col) }).stroke({ width: 1, color: 0x000000, alpha: 0.6 });
          const e = planeToIso((b.entrance.x + 0.5) * TILE, (b.entrance.y + 0.5) * TILE, 0);
          gr.ellipse(e.x, e.y, 3, 1.5).fill(0x000000);
        },
      });
    }
    for (let r = 0; r < NB; r++) {
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
    this.hoverG.clear();
    if (this.hover) {
      const t = this.selected ? this.anchor(this.hover) : this.hover, fp = this.selected ? FOOTPRINT[this.selected] : null;
      const ok = !fp || checkPlace(this.w, this.sector, this.selected!, t.x, t.y) === null;
      this.hoverG.poly(this.quad(t.x, t.y, fp?.w ?? 1, fp?.h ?? 1))
        .fill({ color: ok ? 0x66ff66 : 0xff5050, alpha: 0.25 }).stroke({ width: 1.5, color: ok ? 0xaaffaa : 0xff8080 });
    }
    if (++this.frame % 20 === 0) {
      if (this.signature() !== this.lastSig) this.rebuild();
      this.updatePanel();
    }
  };

  /** Дешева сигнатура видимого стану (вузли зрубано/виросло, кількість будівель): без змін — шари не перебудовуємо. */
  private lastSig = '';
  private signature(): string {
    const rt = getSectorRt(this.w, this.sector);
    let h = 0, grown = 0;
    for (let i = 0; i < rt.kind.length; i++) if (rt.kind[i] && rt.amount[i] > 0) { grown++; h = (h * 31 + i) | 0; }
    return `${grown}:${h}:${rt.buildings.length}`;
  }

  private updatePanel(): void {
    const p = this.w.state.players.find((x) => x.id === this.player)!;
    const idle = this.w.state.npcs.count - this.w.npc.workplace.reduce((a, v) => a + (v >= 0 ? 1 : 0), 0);
    this.panel.querySelector('#cityRes')!.innerHTML =
      Object.entries(RES_NAMES).map(([k, name]) => `${name}: <b>${p.resources[k as 'wood']}</b>`).join(' · ') +
      `<br>Жителів: <b>${this.w.state.npcs.count}</b>, вільних: <b>${idle}</b>`;
    this.updateResidents();
    this.panel.querySelectorAll<HTMLButtonElement>('button[data-k]').forEach((btn) => {
      const k = btn.dataset.k as BuildingKind, c = buildCheck(this.w, this.player, k);
      btn.classList.toggle('no', !c.ok);
      btn.title = c.ok ? (c.free ? 'Перший лісоруб безкоштовний' : '') : `Не вистачає: ${this.missingText(k)}`;
    });
    // Рядки «Виробництво» живуть постійно й оновлюються на місці: інакше кнопка зникає між mousedown і click.
    const host = this.panel.querySelector('#cityFlow')!;
    const live = this.w.state.buildings.filter((b) => MAX_WORKERS[b.kind] && b.kind !== 'warehouse');
    if (!this.flowTitle) { this.flowTitle = document.createElement('h3'); this.flowTitle.textContent = 'Виробництво'; }
    if (live.length && !this.flowTitle.parentNode) host.prepend(this.flowTitle);
    if (!live.length && this.flowTitle.parentNode) this.flowTitle.remove();
    const ids = new Set(live.map((b) => b.id));
    for (const [id, r] of this.flowRows) if (!ids.has(id)) { r.row.remove(); this.flowRows.delete(id); }
    for (const b of live) {
      let r = this.flowRows.get(b.id);
      if (!r) {
        const row = document.createElement('div'), text = document.createElement('span');
        row.append(text);
        let btn: HTMLButtonElement | null = null;
        if (b.kind === 'sawmill') { btn = document.createElement('button'); btn.dataset.pause = String(b.id); row.append(' ', btn); }
        host.append(row);
        r = { row, text, btn };
        this.flowRows.set(b.id, r);
      }
      const out = b.kind === 'sawmill' ? 'planks' : b.kind === 'quarry' ? 'stone' : 'wood';
      const rate = ratePerSec(this.w, b.id, 'produced', out);
      const starved = this.w.state.flows.last.byBuilding[b.id]?.starved ?? 0;
      const why = starved > 20 ? ` — простій: ${WHY[this.w.why.get(b.id) ?? ''] ?? '?'}` : '';
      const txt = `${BUILD_NAMES[b.kind]} #${b.id} — працівників ${b.workers.length}/${MAX_WORKERS[b.kind]}, ефективність ${Math.round((b.workers.length / Math.max(1, MAX_WORKERS[b.kind] ?? 1)) * 100)}%: ${RES_NAMES[out]} ${rate.toFixed(2)}/с${why}${b.roadAttached ? ' 🛣' : ''}`;
      if (r.text.textContent !== txt) r.text.textContent = txt;
      r.text.classList.toggle('bad', starved > 20);
      if (r.btn) { const l = b.paused ? '▶ Пуск' : '⏸ Пауза'; if (r.btn.textContent !== l) r.btn.textContent = l; }
    }
  }

  /** Стан кожного жителя: зведення в заголовку, список — у <pre> (текст оновлюється на місці). */
  private updateResidents(): void {
    const list = residents(this.w, this.player);
    const cnt = new Map<string, number>();
    for (const r of list) cnt.set(r.state, (cnt.get(r.state) ?? 0) + 1);
    const sum = [...cnt].map(([k, v]) => `${STATE_TXT[k]}: ${v}`).join(', ');
    const el = this.panel.querySelector('#cityPeopleSum')!;
    const head = `Жителі (${list.length}): ${sum}`;
    if (el.textContent !== head) el.textContent = head;
    const det = this.panel.querySelector('#cityPeople') as HTMLDetailsElement;
    if (!det.open) return;
    const txt = list.slice(0, 60).map((r) => {
      const where = r.workplace >= 0 ? ` #${r.workplace}` : '';
      const why = r.why && r.state === 'waiting' ? ` (${WHY[r.why] ?? r.why})` : '';
      return `#${r.id} ${PROF_TXT[r.profession] ?? r.profession}${where}: ${STATE_TXT[r.state]}${why}`;
    }).join('\n');
    const pre = this.panel.querySelector('#cityPeopleList')!;
    if (pre.textContent !== txt) pre.textContent = txt;
  }

  destroy(): void {
    window.clearInterval(this.timer);
    this.app.ticker.remove(this.draw);
    this.app.canvas.removeEventListener('pointermove', this.move);
    this.app.canvas.removeEventListener('pointerdown', this.down);
    this.app.canvas.removeEventListener('pointerup', this.up);
    this.app.canvas.removeEventListener('wheel', this.wheel);
    this.app.stage.removeChild(this.root);
    this.root.destroy({ children: true });
    this.panel.remove();
  }
}
