import { Graphics } from 'pixi.js';
import { ROAD_CURB, ROAD_RADIUS, SECTOR_SIZE } from '../../shared';
import { getSectorRt } from '../../sim';
import { planeToIso } from '../projection';
import { PALETTE } from '../style';
import { TILE, type Scene } from './scene';

/**
 * Стежки й дороги поверх землі. Кожна стадія — об'єднання капсул (круглі стики) між центрами сусідніх тайлів стадії ≥ st:
 * краї рівні, кути згладжені, без зубців. Спершу темніший бордюр (ширший), потім заливка. Радіуси — ROAD_RADIUS.
 */
export class Roads {
  readonly g = new Graphics();
  /** Стадії змінились: перемалювати при наступній перебудові. */
  dirty = true;

  redrawIfDirty(scene: Scene): void {
    if (!this.dirty) return;
    const rt = getSectorRt(scene.w, scene.sector);
    const g = this.g, T = SECTOR_SIZE;
    g.clear();
    const disc = (cx: number, cy: number, r: number): number[] => {
      const pts: number[] = [];
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2, v = planeToIso((cx + Math.cos(a) * r) * TILE, (cy + Math.sin(a) * r) * TILE);
        pts.push(v.x, v.y);
      }
      return pts;
    };
    const cap = (ax: number, ay: number, bx: number, by: number, r: number): number[] => {
      const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy), nx = (-dy / l) * r, ny = (dx / l) * r;
      return [[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]].flatMap(([x, y]) => { const v = planeToIso(x * TILE, y * TILE); return [v.x, v.y]; });
    };
    const NB4 = [[1, 0], [0, 1], [1, 1], [-1, 1]];
    for (let st = 1; st <= 3; st++) {
      for (const [r, color] of [[ROAD_RADIUS[st] + ROAD_CURB, PALETTE.trailAlt[st]], [ROAD_RADIUS[st], PALETTE.trail[st]]] as const) {
        for (let i = 0; i < rt.stage.length; i++) {
          if (rt.stage[i] < st) continue;
          const tx = i % T, ty = (i / T) | 0, cx = tx + 0.5, cy = ty + 0.5;
          g.poly(disc(cx, cy, r)).fill(color);
          for (const [dx, dy] of NB4) {
            const nx = tx + dx, ny = ty + dy;
            if (nx < 0 || ny < 0 || nx >= T || ny >= T || rt.stage[ny * T + nx] < st) continue;
            g.poly(cap(cx, cy, nx + 0.5, ny + 0.5, r)).fill(color);
          }
        }
      }
    }
    this.dirty = false;
  }
}
