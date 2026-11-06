import { Application, Container, Graphics } from 'pixi.js';
import type { GameState, ResourceKind } from '../shared';
import {
  HEX_SIZE, depthOrder, pickTile, tileGeometry, zoomAt, type Camera,
} from './projection';
import { SECTOR_RESOURCES } from '../sim/worldgen';

export { HEX_SIZE };

export const RESOURCE_COLORS: Record<string, number> = {
  wood: 0x3f8f3f, stone: 0x8a8a96, ore: 0xb5651d, water: 0x3a7bd5, food: 0xd9c54a, gold: 0xffd700,
};
export const RESOURCE_NAMES: Record<string, string> = {
  wood: 'Дерево', stone: 'Камінь', ore: 'Руда', water: 'Вода', food: 'Їжа', gold: 'Золото',
};

type MapState = Pick<GameState, 'sectors' | 'players' | 'world'>;

export function dominantResource(richness: Partial<Record<ResourceKind, number>>): ResourceKind {
  let best: ResourceKind = 'wood', bv = -1;
  for (const { kind } of SECTOR_RESOURCES) {
    const v = richness[kind] ?? 0;
    if (v > bv) { bv = v; best = kind; }
  }
  return best;
}

/** Висота «плитки» за ресурсом (камінь/руда піднімають сектор), у світових пікселях. */
export function sectorHeight(r: Partial<Record<ResourceKind, number>>): number {
  return Math.round(4 + 16 * Math.max(r.stone ?? 0, r.ore ?? 0));
}

const shade = (color: number, f: number): number => {
  const r = Math.round(((color >> 16) & 255) * f), g = Math.round(((color >> 8) & 255) * f), b = Math.round((color & 255) * f);
  return (r << 16) | (g << 8) | b;
};

export class MapView {
  readonly world = new Container();
  private tiles = new Graphics();
  private overlay = new Graphics();
  private dragging = false;
  private moved = false;
  private last = { x: 0, y: 0 };
  hoverId: number | null = null;
  /** Примірений (ще не підтверджений) сектор: жовта рамка. */
  selectedId: number | null = null;
  onHover: (id: number | null, clientX: number, clientY: number) => void = () => {};
  onClick: (id: number) => void = () => {};
  /** Чи сектор заборонений для старту (підсвічується червоним при наведенні). */
  blocked: (id: number) => boolean = () => false;

  constructor(app: Application, private getState: () => MapState) {
    this.world.addChild(this.tiles, this.overlay);
    app.stage.addChild(this.world);
    this.world.position.set(app.screen.width / 2, app.screen.height / 2);
    this.world.scale.set(0.9);
    const el = app.canvas;
    el.addEventListener('pointerdown', (e) => {
      this.dragging = true; this.moved = false; this.last = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (this.dragging) {
        const dx = e.clientX - this.last.x, dy = e.clientY - this.last.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) this.moved = true;
        if (this.moved) {
          this.world.position.x += dx; this.world.position.y += dy;
          this.last = { x: e.clientX, y: e.clientY };
        }
      }
      this.updateHover(e.clientX, e.clientY);
    });
    el.addEventListener('pointerup', () => {
      const wasClick = this.dragging && !this.moved;
      this.dragging = false;
      if (wasClick && this.hoverId !== null) this.onClick(this.hoverId);
    });
    el.addEventListener('pointerleave', () => { this.hoverId = null; this.drawOverlay(); this.onHover(null, 0, 0); });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const c = zoomAt(this.camera(), e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
      this.world.position.set(c.x, c.y);
      this.world.scale.set(c.zoom);
    }, { passive: false });
  }

  /** Поточна камера (пан+зум; обертання відсутнє за дизайном). */
  camera(): Camera {
    return { x: this.world.position.x, y: this.world.position.y, zoom: this.world.scale.x };
  }

  private updateHover(cx: number, cy: number): void {
    const tiles = this.getState().sectors.map((x) => ({ id: x.id, hex: x.hex, height: sectorHeight(x.richness) }));
    this.hoverId = pickTile(tiles, cx, cy, this.camera());
    this.drawOverlay();
    this.onHover(this.hoverId, cx, cy);
  }

  /** Перемалювати всі сектори (після зміни стану). */
  redraw(): void {
    const st = this.getState();
    const g = this.tiles;
    g.clear();
    const order = [...st.sectors].sort((a, b) => depthOrder(a.hex, b.hex));
    for (const s of order) {
      const dom = dominantResource(s.richness);
      const base = RESOURCE_COLORS[dom];
      const geo = tileGeometry(s.hex, sectorHeight(s.richness));
      const strength = 0.55 + 0.45 * (s.richness[dom] ?? 0);
      for (const w of geo.walls) g.poly(w.poly).fill({ color: shade(base, w.shade) });
      const top = geo.top;
      g.poly(top).fill({ color: base, alpha: strength }).stroke({ width: 1, color: 0x000000, alpha: 0.25 });
      const owner = st.players.find((pl) => pl.ownedSectors.includes(s.id));
      if (owner) g.poly(top).stroke({ width: 4, color: owner.color });
    }
    this.drawOverlay();
  }

  private drawOverlay(): void {
    const g = this.overlay;
    g.clear();
    if (this.selectedId !== null) {
      const sel = this.getState().sectors[this.selectedId];
      g.poly(tileGeometry(sel.hex, sectorHeight(sel.richness)).top).stroke({ width: 5, color: 0xffd54f });
    }
    if (this.hoverId === null) return;
    const s = this.getState().sectors[this.hoverId];
    const bad = this.blocked(this.hoverId);
    g.poly(tileGeometry(s.hex, sectorHeight(s.richness)).top)
      .fill({ color: bad ? 0xff3030 : 0xffffff, alpha: 0.25 })
      .stroke({ width: 3, color: bad ? 0xff5050 : 0xffffff });
  }
}
