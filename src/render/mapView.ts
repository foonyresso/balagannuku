import { Application, Container, Graphics } from 'pixi.js';
import type { GameState, ResourceKind } from '../shared';
import { hexToPixel, pixelToHex } from '../sim/hex';
import { SECTOR_RESOURCES } from '../sim/worldgen';

export const HEX_SIZE = 40;

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

const corners = (): number[] => {
  const pts: number[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push(Math.cos(a) * (HEX_SIZE - 1.5), Math.sin(a) * (HEX_SIZE - 1.5));
  }
  return pts;
};
const at = (pts: number[], p: { x: number; y: number }) => pts.map((v, i) => v + (i % 2 ? p.y : p.x));

export class MapView {
  readonly world = new Container();
  private tiles = new Graphics();
  private overlay = new Graphics();
  private dragging = false;
  private moved = false;
  private last = { x: 0, y: 0 };
  hoverId: number | null = null;
  onHover: (id: number | null, clientX: number, clientY: number) => void = () => {};
  onClick: (id: number) => void = () => {};
  /** Чи сектор заборонений для старту (підсвічується червоним при наведенні). */
  blocked: (id: number) => boolean = () => false;

  constructor(app: Application, private getState: () => MapState) {
    this.world.addChild(this.tiles, this.overlay);
    app.stage.addChild(this.world);
    this.world.position.set(app.screen.width / 2, app.screen.height / 2);
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
      const k = Math.exp(-e.deltaY * 0.0015);
      const s0 = this.world.scale.x, s1 = Math.min(3, Math.max(0.25, s0 * k));
      const px = e.clientX, py = e.clientY;
      this.world.position.x = px - ((px - this.world.position.x) / s0) * s1;
      this.world.position.y = py - ((py - this.world.position.y) / s0) * s1;
      this.world.scale.set(s1);
    }, { passive: false });
  }

  private updateHover(cx: number, cy: number): void {
    const s = this.world.scale.x;
    const h = pixelToHex((cx - this.world.position.x) / s, (cy - this.world.position.y) / s, HEX_SIZE);
    const id = this.getState().sectors.findIndex((x) => x.hex.q === h.q && x.hex.r === h.r);
    this.hoverId = id >= 0 ? id : null;
    this.drawOverlay();
    this.onHover(this.hoverId, cx, cy);
  }

  /** Перемалювати всі сектори (після зміни стану). */
  redraw(): void {
    const st = this.getState();
    const g = this.tiles;
    g.clear();
    const pts = corners();
    for (const s of st.sectors) {
      const dom = dominantResource(s.richness);
      const strength = 0.35 + 0.65 * (s.richness[dom] ?? 0);
      g.poly(at(pts, hexToPixel(s.hex, HEX_SIZE))).fill({ color: RESOURCE_COLORS[dom], alpha: strength });
    }
    for (const pl of st.players) {
      for (const sid of pl.ownedSectors) {
        g.poly(at(pts, hexToPixel(st.sectors[sid].hex, HEX_SIZE))).stroke({ width: 4, color: pl.color });
      }
    }
    this.drawOverlay();
  }

  private drawOverlay(): void {
    const g = this.overlay;
    g.clear();
    if (this.hoverId === null) return;
    const bad = this.blocked(this.hoverId);
    g.poly(at(corners(), hexToPixel(this.getState().sectors[this.hoverId].hex, HEX_SIZE)))
      .fill({ color: bad ? 0xff3030 : 0xffffff, alpha: 0.25 })
      .stroke({ width: 3, color: bad ? 0xff5050 : 0xffffff });
  }
}
