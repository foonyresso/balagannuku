import { Container, Graphics, Sprite, type Renderer } from 'pixi.js';
import type { SectorState } from '../shared';
import { SECTOR_CELLS, SECTOR_SIZE, TILES_PER_CELL as TPC, WORLD_RING } from '../shared';
import { nodeTile } from '../sim';
import { genNode, mixNodeSeed } from '../sim/nodegen';
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
  ) {
    // Одна суцільна земля на весь світ: між секторами немає ліній.
    const gnd = new Graphics(), bb = Surroundings.bounds();
    const pts = [planeToIso(bb.minX, bb.minY), planeToIso(bb.maxX, bb.minY), planeToIso(bb.maxX, bb.maxY), planeToIso(bb.minX, bb.maxY)];
    if (WORLD_RING > 0) { gnd.poly(pts.flatMap((v) => [v.x, v.y])).fill(0x2a3a22); this.back.addChild(gnd); }
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
    // Сусіди = той самий світ: genNode від СВІТОВИХ координат клітинки (з домашнього сектора), без швів на межах.
    const nodeSeed = mixNodeSeed(this.seed, this.home.id);
    const wood = this.home.richness.wood ?? 0.3, stone = this.home.richness.stone ?? 0.3;
    const g = new Graphics();
    // Об'єкти від дальніх рядів до ближніх, щоб крони перекривались правильно.
    const objs: { y: number; draw: () => void }[] = [];
    for (let cy = 0; cy < SECTOR_CELLS; cy++) {
      for (let cx = 0; cx < SECTOR_CELLS; cx++) {
        const wx = cx + dx * SECTOR_CELLS, wy = cy + dy * SECTOR_CELLS;
        const kind = genNode(nodeSeed, wood, stone, wx, wy, SECTOR_CELLS >> 1);
        if (!kind) continue;
        const nt = nodeTile(this.seed, this.home.id, ((wx % 9973) + 9973) % 9973, ((wy % 9973) + 9973) % 9973);
        const jx = nt.x % TPC, jy = nt.y % TPC; // дрібне зміщення всередині клітинки
        const px = (wx * TPC + jx + 0.5) * TILE, py = (wy * TPC + jy + 0.5) * TILE;
        const base = planeToIso(px, py, 0);
        if (kind === 1) {
          const rad = (TREE_TILES * TILE) / 2, top = planeToIso(px, py, 22), mid = planeToIso(px, py, 9);
          objs.push({ y: py, draw: () => {
            g.rect(mid.x - 1.5, mid.y, 3, base.y - mid.y).fill(0x5d4037);
            g.ellipse(top.x, top.y + 3, rad, rad * 1.25).fill(0x1b5e20);
          } });
        } else {
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
