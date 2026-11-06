import { Application, Container, Graphics } from 'pixi.js';
import type { BuildingKind } from '../shared';
import { SECTOR_SIZE, TrailStage } from '../shared';
import {
  applyCommand, getSectorRt, ratePerSec, staffBuilding, stepWorld, NODE_STONE, NODE_TREE, type SimWorld,
} from '../sim';
import { COSTS, MAX_WORKERS } from '../sim/balance';

const CELL = 12;
const STAGE_COLORS = [0, 0x5a4a30, 0x8a7448, 0xb8b0a0];
const BUILD_COLORS: Record<string, number> = {
  townhall: 0xffd54f, warehouse: 0xc19a6b, lumberjack: 0x2e7d32, quarry: 0x9e9e9e, sawmill: 0xd7a86e, house: 0xe57373,
};
const BUILD_NAMES: Partial<Record<BuildingKind, string>> = {
  warehouse: 'Склад', lumberjack: 'Лісоруб', quarry: 'Кар’єр', sawmill: 'Лісопильня', house: 'Будинок',
};
const RES_NAMES: Record<string, string> = { wood: 'Дерево', stone: 'Камінь', planks: 'Дошки' };
const PROF_COLORS = [0xeeeeee, 0x66bb6a, 0xbdbdbd, 0x90caf9, 0xff8a65, 0xba68c8, 0xffcc80];

/** Простий вигляд міста (один сектор): клітинки, будівлі-плейсхолдери, NPC як кольорові точки. */
export class CityView {
  private root = new Container();
  private terrain = new Graphics();
  private dots = new Graphics();
  private panel: HTMLDivElement;
  private selected: BuildingKind | null = 'lumberjack';
  private timer: number | undefined;
  private frame = 0;
  private hover: { x: number; y: number } | null = null;
  private ox = 0;
  private oy = 0;

  constructor(private app: Application, private w: SimWorld, private player: string, private sector: number, private onExit: () => void) {
    this.root.addChild(this.terrain, this.dots);
    app.stage.addChild(this.root);
    this.layout();
    this.panel = document.createElement('div');
    this.panel.id = 'cityPanel';
    document.body.appendChild(this.panel);
    this.buildPanel();
    const el = app.canvas;
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerdown', this.click);
    app.renderer.on('resize', this.layout);
    app.ticker.add(this.draw);
    this.timer = window.setInterval(() => { stepWorld(this.w); }, 100);
    this.drawTerrain();
  }

  private layout = (): void => {
    this.ox = Math.round((this.app.screen.width - SECTOR_SIZE * CELL) / 2);
    this.oy = Math.round((this.app.screen.height - SECTOR_SIZE * CELL) / 2);
    this.root.position.set(this.ox, this.oy);
  };

  private cellAt(e: PointerEvent): { x: number; y: number } | null {
    const x = Math.floor((e.clientX - this.ox) / CELL), y = Math.floor((e.clientY - this.oy) / CELL);
    return x >= 0 && y >= 0 && x < SECTOR_SIZE && y < SECTOR_SIZE ? { x, y } : null;
  }
  private move = (e: PointerEvent): void => { this.hover = this.cellAt(e); };
  private click = (e: PointerEvent): void => {
    const c = this.cellAt(e);
    if (!c || !this.selected) return;
    const r = applyCommand(this.w, { player: this.player, seq: 0, cmd: { type: 'place_building', kind: this.selected, sector: this.sector, cell: c } });
    const msg = this.panel.querySelector('#cityMsg')!;
    if (!r.ok) { msg.textContent = r.reason === 'no_resources' ? 'Не вистачає ресурсів' : 'Тут не можна'; return; }
    const b = this.w.state.buildings[this.w.state.buildings.length - 1];
    const n = staffBuilding(this.w, this.player, b.id);
    msg.textContent = n ? `Побудовано, працівників: ${n}` : MAX_WORKERS[b.kind] ? 'Побудовано, немає вільних працівників' : 'Побудовано';
    this.drawTerrain();
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

  /** Статичний шар: ліс, камінь, стежки. Перемальовується рідко. */
  private drawTerrain(): void {
    const g = this.terrain, rt = getSectorRt(this.w, this.sector);
    g.clear();
    g.rect(0, 0, SECTOR_SIZE * CELL, SECTOR_SIZE * CELL).fill(0x2a3a22);
    for (let y = 0; y < SECTOR_SIZE; y++) {
      for (let x = 0; x < SECTOR_SIZE; x++) {
        const i = y * SECTOR_SIZE + x;
        if (rt.stage[i] > TrailStage.None) g.rect(x * CELL, y * CELL, CELL, CELL).fill(STAGE_COLORS[rt.stage[i]]);
        if (rt.amount[i] > 0 && rt.kind[i] === NODE_TREE) g.circle(x * CELL + CELL / 2, y * CELL + CELL / 2, CELL * 0.42).fill(0x1b5e20);
        else if (rt.amount[i] > 0 && rt.kind[i] === NODE_STONE) g.rect(x * CELL + 2, y * CELL + 2, CELL - 4, CELL - 4).fill(0x78787f);
      }
    }
    for (const b of rt.buildings) {
      g.rect(b.cell.x * CELL, b.cell.y * CELL, CELL, CELL).fill(BUILD_COLORS[b.kind] ?? 0xffffff).stroke({ width: 1, color: 0x000000 });
      g.rect(b.entrance.x * CELL + 4, b.entrance.y * CELL + 4, CELL - 8, CELL - 8).fill(0x000000);
    }
  }

  private draw = (): void => {
    const n = this.w.state.npcs, g = this.dots;
    g.clear();
    for (let i = 0; i < n.capacity; i++) {
      if (!n.alive[i] || n.sector[i] !== this.sector) continue;
      g.circle(n.x[i] * CELL, n.y[i] * CELL, 2.6).fill(n.carryAmount[i] ? 0xfff176 : PROF_COLORS[n.profession[i]] ?? 0xffffff);
    }
    if (this.hover) g.rect(this.hover.x * CELL, this.hover.y * CELL, CELL, CELL).stroke({ width: 1, color: 0xffffff });
    if (++this.frame % 20 === 0) { this.drawTerrain(); this.updatePanel(); }
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
    this.app.renderer.off('resize', this.layout);
    this.app.canvas.removeEventListener('pointermove', this.move);
    this.app.canvas.removeEventListener('pointerdown', this.click);
    this.app.stage.removeChild(this.root);
    this.root.destroy({ children: true });
    this.panel.remove();
  }
}
