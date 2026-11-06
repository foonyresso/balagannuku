import { Application, Container, Graphics } from 'pixi.js';
import type { BuildingKind } from '../shared';
import { SECTOR_SIZE, TrailStage } from '../shared';
import {
  applyCommand, getSectorRt, ratePerSec, staffBuilding, stepWorld, NODE_STONE, NODE_TREE, type SimWorld,
} from '../sim';
import { COSTS, MAX_WORKERS } from '../sim/balance';
import { planeToIso, pointInPoly, screenToPlane, zoomAt, type Camera, type Vec2 } from './projection';

/** Розмір клітинки міста в одиницях площини (та сама проєкція, що й у карти). */
const C = 16;
const BUILD_H: Record<string, number> = { townhall: 22, warehouse: 12, lumberjack: 12, quarry: 10, sawmill: 16, house: 14 };

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
const PROF_COLORS = [0xeeeeee, 0x66bb6a, 0xbdbdbd, 0x90caf9, 0xff8a65, 0xba68c8, 0xffcc80];

interface Obj { x: number; y: number; draw: (g: Graphics) => void; pick: number[] | null; cell: { x: number; y: number } | null }

/** Вигляд міста одного сектора в тій самій ізометрії, що й карта: пан, зум, малювання за глибиною, пікінг за порядком малювання. */
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
  private hover: { x: number; y: number } | null = null;
  private cam: Camera;
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private rows: Obj[][] = [];

  constructor(private app: Application, private w: SimWorld, private player: string, private sector: number, private onExit: () => void) {
    this.root.addChild(this.ground);
    for (let r = 0; r < SECTOR_SIZE; r++) {
      const o = new Graphics(), n = new Graphics();
      this.rowObj.push(o); this.rowNpc.push(n);
      this.root.addChild(o, n);
    }
    this.root.addChild(this.hoverG);
    app.stage.addChild(this.root);
    const mid = planeToIso((SECTOR_SIZE * C) / 2, (SECTOR_SIZE * C) / 2);
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
    this.timer = window.setInterval(() => { stepWorld(this.w); }, 100);
    this.rebuild();
  }

  private applyCam(): void {
    this.root.position.set(this.cam.x, this.cam.y);
    this.root.scale.set(this.cam.zoom);
  }

  /** Клітинка під курсором: спершу об'єкти від найближчого до глядача (за порядком малювання), далі земля. */
  private pickCell(e: PointerEvent): { x: number; y: number } | null {
    const p = { x: (e.clientX - this.cam.x) / this.cam.zoom, y: (e.clientY - this.cam.y) / this.cam.zoom };
    for (let r = SECTOR_SIZE - 1; r >= 0; r--) {
      for (const o of this.rows[r]) if (o.pick && o.cell && pointInPoly(p.x, p.y, o.pick)) return o.cell;
    }
    const g = screenToPlane(e.clientX, e.clientY, this.cam);
    const x = Math.floor(g.x / C), y = Math.floor(g.y / C);
    return x >= 0 && y >= 0 && x < SECTOR_SIZE && y < SECTOR_SIZE ? { x, y } : null;
  }
  private move = (e: PointerEvent): void => {
    if (this.drag) {
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      if (this.drag.moved || Math.abs(dx) + Math.abs(dy) > 4) {
        this.drag.moved = true; this.cam.x += dx; this.cam.y += dy;
        this.drag.x = e.clientX; this.drag.y = e.clientY; this.applyCam();
      }
    }
    this.hover = this.pickCell(e);
  };
  private down = (e: PointerEvent): void => { this.drag = { x: e.clientX, y: e.clientY, moved: false }; };
  private up = (e: PointerEvent): void => {
    const d = this.drag; this.drag = null;
    if (!d || d.moved) return;
    const c = this.pickCell(e);
    if (!c || !this.selected) return;
    const r = applyCommand(this.w, { player: this.player, seq: 0, cmd: { type: 'place_building', kind: this.selected, sector: this.sector, cell: c } });
    const msg = this.panel.querySelector('#cityMsg')!;
    if (!r.ok) { msg.textContent = r.reason === 'no_resources' ? 'Не вистачає ресурсів' : 'Тут не можна'; return; }
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

  private buildPanel(): void {
    const btns = (Object.keys(BUILD_NAMES) as BuildingKind[]).map((k) => {
      const cost = Object.entries(COSTS[k] ?? {}).map(([r, v]) => `${v} ${RES_NAMES[r]?.toLowerCase()}`).join(', ');
      return `<button data-k="${k}">${BUILD_NAMES[k]} <small>(${cost})</small></button>`;
    }).join('');
    this.panel.innerHTML = `<h2>Місто</h2><div id="cityRes"></div><div class="btns">${btns}</div>` +
      `<div id="cityMsg">Обери будівлю й клікни по клітинці</div><div id="cityFlow"></div><button id="cityBack">← До карти</button>`;
    this.panel.querySelectorAll<HTMLButtonElement>('button[data-k]').forEach((b) => {
      b.onclick = () => { this.selected = b.dataset.k as BuildingKind; this.markSel(); };
    });
    (this.panel.querySelector('#cityBack') as HTMLButtonElement).onclick = () => this.onExit();
    this.markSel();
  }
  private markSel(): void {
    this.panel.querySelectorAll<HTMLButtonElement>('button[data-k]').forEach((b) => b.classList.toggle('sel', b.dataset.k === this.selected));
  }

  private quad(x: number, y: number, w: number, h: number, z = 0): number[] {
    const p = [planeToIso(x, y, z), planeToIso(x + w, y, z), planeToIso(x + w, y + h, z), planeToIso(x, y + h, z)];
    return p.flatMap((v: Vec2) => [v.x, v.y]);
  }

  /** Перебудувати землю й об'єкти (дерева, камінь, будівлі) по рядках глибини. Викликається рідко. */
  private rebuild(): void {
    const rt = getSectorRt(this.w, this.sector);
    const g = this.ground;
    g.clear();
    g.poly(this.quad(0, 0, SECTOR_SIZE * C, SECTOR_SIZE * C)).fill(0x2a3a22);
    this.rows = Array.from({ length: SECTOR_SIZE }, () => []);
    for (let y = 0; y < SECTOR_SIZE; y++) {
      for (let x = 0; x < SECTOR_SIZE; x++) {
        const i = y * SECTOR_SIZE + x;
        if (rt.stage[i] > TrailStage.None) g.poly(this.quad(x * C, y * C, C, C)).fill(STAGE_COLORS[rt.stage[i]]);
        if (!rt.kind[i] || rt.blocked[i]) continue;
        const cx = x * C + C / 2, cy = y * C + C / 2, grown = rt.amount[i] > 0, cell = { x, y };
        if (rt.kind[i] === NODE_TREE) {
          const top = planeToIso(cx, cy, 26), base = planeToIso(cx, cy, 0);
          this.rows[y].push({
            x, y, cell,
            pick: grown ? [top.x - 6, top.y - 6, top.x + 6, top.y - 6, base.x + 6, base.y + 2, base.x - 6, base.y + 2] : null,
            draw: (gr) => {
              if (!grown) { gr.ellipse(base.x, base.y, 3, 2).fill(0x5d4037); return; }
              const mid = planeToIso(cx, cy, 10);
              gr.rect(mid.x - 1.5, mid.y, 3, base.y - mid.y).fill(0x5d4037);
              gr.ellipse(top.x, top.y + 4, 7, 9).fill(0x1b5e20);
            },
          });
        } else if (rt.kind[i] === NODE_STONE) {
          const base = planeToIso(cx, cy, 0);
          this.rows[y].push({
            x, y, cell, pick: null,
            draw: (gr) => { gr.ellipse(base.x, base.y - (grown ? 3 : 1), grown ? 7 : 4, grown ? 5 : 2.5).fill(grown ? 0x78787f : 0x55555a); },
          });
        }
      }
    }
    for (const b of rt.buildings) {
      const h = BUILD_H[b.kind] ?? 12, col = BUILD_COLORS[b.kind] ?? 0xffffff;
      const x0 = b.cell.x * C, y0 = b.cell.y * C;
      const top = this.quad(x0, y0, C, C, h);
      const front = [planeToIso(x0, y0 + C, h), planeToIso(x0 + C, y0 + C, h), planeToIso(x0 + C, y0 + C, 0), planeToIso(x0, y0 + C, 0)].flatMap((v) => [v.x, v.y]);
      const pick = [top[0], top[1], top[2], top[3], front[4], front[5], front[6], front[7]]; // силует: верх + фасад
      this.rows[b.cell.y].push({
        x: b.cell.x, y: b.cell.y, cell: b.cell, pick,
        draw: (gr) => {
          gr.poly(front).fill({ color: col }).stroke({ width: 1, color: 0x000000, alpha: 0.6 });
          gr.poly(top).fill({ color: lighten(col) }).stroke({ width: 1, color: 0x000000, alpha: 0.6 });
          const e = planeToIso(b.entrance.x * C + C / 2, b.entrance.y * C + 2, 0);
          gr.ellipse(e.x, e.y, 3, 1.5).fill(0x000000);
        },
      });
    }
    for (let r = 0; r < SECTOR_SIZE; r++) {
      const gr = this.rowObj[r];
      gr.clear();
      for (const o of this.rows[r]) o.draw(gr);
    }
  }

  private draw = (): void => {
    const n = this.w.state.npcs;
    for (const g of this.rowNpc) g.clear();
    for (let i = 0; i < n.capacity; i++) {
      if (!n.alive[i] || n.sector[i] !== this.sector) continue;
      const px = n.x[i] * C, py = n.y[i] * C;
      const row = Math.min(SECTOR_SIZE - 1, Math.max(0, Math.floor(n.y[i])));
      const base = planeToIso(px, py, 0), body = planeToIso(px, py, 7);
      const g = this.rowNpc[row];
      g.ellipse(base.x, base.y, 3, 1.5).fill({ color: 0x000000, alpha: 0.35 });
      g.circle(body.x, body.y, 3).fill(n.carryAmount[i] ? 0xfff176 : PROF_COLORS[n.profession[i]] ?? 0xffffff);
    }
    this.hoverG.clear();
    if (this.hover) this.hoverG.poly(this.quad(this.hover.x * C, this.hover.y * C, C, C)).stroke({ width: 1.5, color: 0xffffff });
    if (++this.frame % 20 === 0) { this.rebuild(); this.updatePanel(); }
  };

  private updatePanel(): void {
    const p = this.w.state.players.find((x) => x.id === this.player)!;
    const idle = this.w.state.npcs.count - this.w.npc.workplace.reduce((a, v) => a + (v >= 0 ? 1 : 0), 0);
    this.panel.querySelector('#cityRes')!.innerHTML =
      Object.entries(RES_NAMES).map(([k, name]) => `${name}: <b>${p.resources[k as 'wood']}</b>`).join(' · ') +
      `<br>Жителів: <b>${this.w.state.npcs.count}</b>, вільних: <b>${idle}</b>`;
    const rows = this.w.state.buildings.filter((b) => MAX_WORKERS[b.kind]).map((b) => {
      const out = b.kind === 'sawmill' ? 'planks' : b.kind === 'quarry' ? 'stone' : 'wood';
      const rate = ratePerSec(this.w, b.id, 'produced', out);
      const starved = this.w.state.flows.last.byBuilding[b.id]?.starved ?? 0;
      return `<div>${BUILD_NAMES[b.kind]} #${b.id} (${b.workers.length}/${MAX_WORKERS[b.kind]}): ${RES_NAMES[out]} ${rate.toFixed(2)}/с` +
        `${starved > 20 ? ' <span class="bad">простій</span>' : ''}${b.roadAttached ? ' 🛣' : ''}</div>`;
    }).join('');
    this.panel.querySelector('#cityFlow')!.innerHTML = rows ? `<h3>Виробництво</h3>${rows}` : '';
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
