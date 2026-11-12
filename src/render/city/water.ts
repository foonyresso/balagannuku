import { Graphics } from 'pixi.js';
import { ACTIVE_MAX_TILE, ACTIVE_MIN_TILE, SECTOR_SIZE } from '../../shared';
import { getSectorRt } from '../../sim';
import { planeToIso, screenToPlane } from '../projection';
import { PALETTE, variant } from '../style';
import { TILE, quad, type Scene } from './scene';

/** Вода: статичний шар (мілина, глибина, берег) і блиск, що мерехтить щокадру. */
export class Water {
  /** Статична вода; малюється один раз. */
  readonly g = new Graphics();
  /** Блиск поверх води. */
  readonly shine = new Graphics();
  /** Кандидати блиску: пари (x, y) водних тайлів. */
  private tiles: number[] = [];

  /** Берегова мілина + глибина (тайли, всі сусіди яких теж вода), каламутний берег. Горизонтальні серії зливаємо в один прямокутник. */
  constructor(scene: Scene) {
    const rt = getSectorRt(scene.w, scene.sector), g = this.g, T = SECTOR_SIZE, wt = rt.water;
    const runs = (pred: (i: number) => boolean, color: number) => {
      for (let y = ACTIVE_MIN_TILE; y < ACTIVE_MAX_TILE; y++) {
        let x0 = -1;
        for (let x = ACTIVE_MIN_TILE; x <= ACTIVE_MAX_TILE; x++) {
          const on = x < ACTIVE_MAX_TILE && pred(y * T + x);
          if (on && x0 < 0) x0 = x;
          else if (!on && x0 >= 0) { g.poly(quad(x0, y, x - x0, 1)).fill(color); x0 = -1; }
        }
      }
    };
    const near = (i: number) => wt[i - 1] === 1 || wt[i + 1] === 1 || wt[i - T] === 1 || wt[i + T] === 1;
    // берег: суша поруч із водою (поширено на тайл у кожен бік)
    runs((i) => wt[i] !== 1 && (near(i) || wt[i - T - 1] === 1 || wt[i - T + 1] === 1 || wt[i + T - 1] === 1 || wt[i + T + 1] === 1), PALETTE.shore);
    runs((i) => wt[i] === 1, PALETTE.waterShallow);
    runs((i) => wt[i] === 1 && wt[i - 1] === 1 && wt[i + 1] === 1 && wt[i - T] === 1 && wt[i + T] === 1, PALETTE.waterDeep);
    // кандидати блиску: детермінований добір водних тайлів (не більше ~900)
    for (let y = ACTIVE_MIN_TILE; y < ACTIVE_MAX_TILE; y += 3) for (let x = ACTIVE_MIN_TILE; x < ACTIVE_MAX_TILE; x += 3) {
      const i = y * T + x;
      if (wt[i] === 1 && variant(x, y, 5, 3) === 0 && this.tiles.length < 1800) this.tiles.push(x, y);
    }
  }

  /** Блиск води: кілька «зайчиків» на видимих тайлах, мерехтять за часом. */
  drawShine(scene: Scene): void {
    const g = this.shine;
    g.clear();
    const wt = this.tiles;
    if (!wt.length) return;
    const { app, cam } = scene;
    const top = screenToPlane(0, 0, cam), bot = screenToPlane(app.screen.width, app.screen.height, cam);
    const x0 = top.x / TILE - 4, x1 = bot.x / TILE + 4, y0 = top.y / TILE - 4, y1 = bot.y / TILE + 4;
    for (let k = 0; k < wt.length; k += 2) {
      const x = wt[k], y = wt[k + 1];
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      if (Math.sin(scene.animT * 1.5 + k * 3.1) <= 0.55) continue;
      const c = planeToIso((x + 0.5) * TILE, (y + 0.5) * TILE);
      g.rect(c.x - 1.2, c.y, 2.4, 0.5).fill({ color: 0xc8e6fa, alpha: 0.6 });
    }
  }
}
