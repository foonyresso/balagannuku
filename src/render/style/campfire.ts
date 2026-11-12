import { CAMP_TILES } from '../../shared';
import { BPainter, defineBuilding, logs, plain, registerBuildingStyle } from './buildings';

/**
 * Вогнище для вільних жителів: кільце з каміння, дрова, полум'я. Не споруда гравця (немає в `BUILDINGS`):
 * позицію дає `sim/systems/camp.ts`, спрайт кладе `render/city/campfire.ts`. Тут же — світло й дим вогню.
 */
const STONE = plain('#7d7a80'), STONE_DK = plain('#55525a');

registerBuildingStyle('campfire', { zMax: 12, paint(p: BPainter) {
  const { w, d } = p, cx = w / 2, cy = d / 2;
  p.yf = cy + 3;
  // випалена земля під вогнищем
  p.top(cx - 4.2, cx + 4.2, cy - 2.6, cy + 2.6, 0.02, plain('#3a2c26'), 1);
  // дрова: два схрещені поліна
  p.box(cx - 3, cx + 3, cy - 0.8, cy + 0.8, 0.2, 1.6, logs('#8a5e38', '#4a3020', 3), plain('#6a4a30'));
  p.box(cx - 0.9, cx + 0.9, cy - 2.6, cy + 2.4, 0.2, 1.4, logs('#7a5230', '#3e281a', 3), plain('#5e4028'));
  // полум'я: три язики, від червоного до жовтого
  const tongue = (x: number, wd: number, h: number, col: string): void => p.face([[x - wd, cy + 1, 1.2], [x + wd, cy + 1, 1.2], [x, cy + 1, 1.2 + h]], plain(col), 1, false);
  tongue(cx - 0.6, 2.2, 6.4, '#d8481e'); tongue(cx + 1.2, 1.8, 5.2, '#e8641e');
  tongue(cx, 1.8, 7.4, '#f08a2a'); tongue(cx - 0.2, 1, 5, '#ffd25a');
  // каміння по колу: фасадні лежать попереду, бокові й задні ззаду (видно як вінець)
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2, sx = cx + Math.cos(a) * 4.3, sy = cy + Math.sin(a) * 3.2;
    p.box(sx - 0.9, sx + 0.9, sy - 0.7, sy + 0.7, 0, 1.5 + (k % 3) * 0.3, k % 2 ? STONE : STONE_DK, plain('#8a8790'));
  }
  // світло: широке м'яке й яскраве ядро; дим
  p.fx.lights.push({ x: cx, y: cy + 2, z: 3, r: 110, rgb: '255,150,60', a: 0.85 });
  p.fx.lights.push({ x: cx, y: cy + 2, z: 3, r: 40, rgb: '255,200,110', a: 0.7 });
  p.fx.smoke.push({ x: cx, y: cy, z: 9 });
} });

/** Спрайт вогнища в атлас (до першого `ensureAtlas`). */
export function registerCampfireSprite(tile: number): void { defineBuilding('campfire', CAMP_TILES, CAMP_TILES, tile); }
