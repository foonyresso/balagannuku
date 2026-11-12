import { Graphics } from 'pixi.js';
import { ACTIVE_MAX_TILE, ACTIVE_MIN_TILE } from '../../shared';
import { PALETTE } from '../style';
import { quad } from './scene';

/** Туман неактивної смуги: ступінчасте затемнення до краю карти (поверх лісу й каміння). */
export function makeFog(): Graphics {
  const g = new Graphics(), A = ACTIVE_MIN_TILE, Z = ACTIVE_MAX_TILE, n = 8, step = A / n;
  const frame = (i0: number, i1: number, alpha: number) => { // кільце між відступами i0 < i1 тайлів від активного краю назовні
    const a0 = A - i0, b0 = Z + i0, a1 = A - i1, b1 = Z + i1;
    for (const q of [[a1, a1, b1 - a1, i1 - i0], [a1, b0, b1 - a1, i1 - i0], [a1, a0, i1 - i0, b0 - a0], [b0, a0, i1 - i0, b0 - a0]]) {
      g.poly(quad(q[0], q[1], q[2], q[3])).fill({ color: PALETTE.fog, alpha });
    }
  };
  for (let k = 0; k < n; k++) frame(k * step, (k + 1) * step, 0.3 + 0.06 * k);
  return g;
}
