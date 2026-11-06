import { Container, Graphics, Sprite, type Renderer } from 'pixi.js';
import type { SectorState } from '../shared';
import { SECTOR_CELLS, SECTOR_SIZE, WORLD_RING } from '../shared';
import { NODE_STONE, NODE_TREE, nodeAt, nodeTile } from '../sim';
import { STONE_TILES, TREE_TILES } from '../sim/balance';
import { planeToIso, screenToIso, type Camera } from './projection';

/** Розмір тайла в одиницях площини (узгоджено з CityView). */
const TILE = 4;
const SECTOR_UNITS = SECTOR_SIZE * TILE;
/** Роздільність запеченої текстури сусіднього сектора (0.4 → ~1640×1100 пікселів на сектор). */
const BAKE_RESOLUTION = 0.4;

/**
 * Сусідні сектори навколо домашнього: ландшафт (земля, дерева, камінь) за seed, без міст і жителів.
 * Створюється ліниво: сектор будується лише коли потрапляє в поле зору, не більше одного за кадр.
 * `back` малюється під домашнім сектором (ряд над ним і по боках), `front` — поверх (ряд під ним).
 */
export class Surroundings {
  readonly back = new Container();
  readonly front = new Container();
  private tiles = new Map<string, { s: Sprite }>();
  private pending: { dx: number; dy: number }[] = [];

  constructor(
    private renderer: Renderer, private seed: number, private home: SectorState,
    private neighbour: (dx: number, dy: number) => SectorState,
  ) {
    for (let dy = -WORLD_RING; dy <= WORLD_RING; dy++) {
      for (let dx = -WORLD_RING; dx <= WORLD_RING; dx++) if (dx || dy) this.pending.push({ dx, dy });
    }
  }

  /** Межі світу в одиницях площини (домашній сектор — [0..SECTOR_UNITS]²). */
  static bounds() {
    return { minX: -WORLD_RING * SECTOR_UNITS, minY: -WORLD_RING * SECTOR_UNITS, maxX: (WORLD_RING + 1) * SECTOR_UNITS, maxY: (WORLD_RING + 1) * SECTOR_UNITS };
  }

  /** Створює (за потреби) один видимий сектор і ховає невидимі. */
  update(cam: Camera, screenW: number, screenH: number): void {
    const tl = screenToIso(0, 0, cam), br = screenToIso(screenW, screenH, cam);
    const seen = (dx: number, dy: number): boolean => {
      // AABB сектора в ізо-просторі (діамант вписано в прямокутник)
      const a = planeToIso(dx * SECTOR_UNITS, dy * SECTOR_UNITS), b = planeToIso((dx + 1) * SECTOR_UNITS, (dy + 1) * SECTOR_UNITS);
      const c = planeToIso((dx + 1) * SECTOR_UNITS, dy * SECTOR_UNITS), d = planeToIso(dx * SECTOR_UNITS, (dy + 1) * SECTOR_UNITS);
      const x0 = Math.min(a.x, b.x, c.x, d.x), x1 = Math.max(a.x, b.x, c.x, d.x);
      const y0 = Math.min(a.y, b.y, c.y, d.y) - 80, y1 = Math.max(a.y, b.y, c.y, d.y);
      return x1 >= tl.x && x0 <= br.x && y1 >= tl.y && y0 <= br.y;
    };
    let built = false;
    for (let i = 0; i < this.pending.length && !built; i++) {
      const { dx, dy } = this.pending[i];
      if (!seen(dx, dy)) continue;
      this.build(dx, dy);
      this.pending.splice(i, 1);
      built = true;
    }
    for (const [key, t] of this.tiles) {
      const [dx, dy] = key.split(',').map(Number);
      t.s.visible = seen(dx, dy);
    }
  }

  private build(dx: number, dy: number): void {
    const sec = this.neighbour(dx, dy);
    // Віртуальний id дає незалежний від домашнього шум; seed той самий.
    const vid = 100000 + (dy + WORLD_RING) * 64 + (dx + WORLD_RING) + this.home.id * 997;
    const view: SectorState = { ...sec, id: vid };
    const ox = dx * SECTOR_UNITS, oy = dy * SECTOR_UNITS;
    const g = new Graphics();
    const q = (x: number, y: number, w: number, h: number) => {
      const p = [planeToIso(ox + x, oy + y), planeToIso(ox + x + w, oy + y), planeToIso(ox + x + w, oy + y + h), planeToIso(ox + x, oy + y + h)];
      return p.flatMap((v) => [v.x, v.y]);
    };
    g.poly(q(0, 0, SECTOR_UNITS, SECTOR_UNITS)).fill(0x2a3a22);
    // Об'єкти від дальніх рядів до ближніх, щоб крони перекривались правильно.
    const objs: { y: number; draw: () => void }[] = [];
    for (let cy = 0; cy < SECTOR_CELLS; cy++) {
      for (let cx = 0; cx < SECTOR_CELLS; cx++) {
        const [kind] = nodeAt(this.seed, view, cx, cy);
        if (!kind) continue;
        const nt = nodeTile(this.seed, vid, cx, cy);
        const px = ox + (nt.x + 0.5) * TILE, py = oy + (nt.y + 0.5) * TILE;
        const base = planeToIso(px, py, 0);
        if (kind === NODE_TREE) {
          const rad = (TREE_TILES * TILE) / 2, top = planeToIso(px, py, 22), mid = planeToIso(px, py, 9);
          objs.push({ y: py, draw: () => {
            g.rect(mid.x - 1.5, mid.y, 3, base.y - mid.y).fill(0x5d4037);
            g.ellipse(top.x, top.y + 3, rad, rad * 1.25).fill(0x1b5e20);
          } });
        } else if (kind === NODE_STONE) {
          const rw = (STONE_TILES * TILE) / 2;
          objs.push({ y: py, draw: () => { g.ellipse(base.x, base.y - 3, rw, rw * 0.7).fill(0x78787f); } });
        }
      }
    }
    objs.sort((a, b) => a.y - b.y);
    for (const o of objs) o.draw();
    // Запікаємо сектор у текстуру (фон: нижча роздільність) — далі це один спрайт, а не десятки тисяч фігур.
    const b = g.getLocalBounds();
    const sprite = new Sprite(this.renderer.generateTexture({ target: g, resolution: BAKE_RESOLUTION }));
    sprite.position.set(b.x, b.y);
    g.destroy();
    (dy > 0 ? this.front : this.back).addChild(sprite);
    this.tiles.set(`${dx},${dy}`, { s: sprite });
  }
}
