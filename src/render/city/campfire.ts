import { Sprite } from 'pixi.js';
import { CAMP_TILES } from '../../shared';
import { campfireOf } from '../../sim';
import { planeToIso } from '../projection';
import { buildingArt } from '../style';
import type { Smoker } from './buildings';
import { TILE, rowOf, type Obj, type Rt, type Scene } from './scene';

/**
 * Вогнище перед кожною готовою ратушею: спрайт у шарі глибини, світло в атмосфері, дим.
 * Позицію дає симуляція (`campfireOf`); не клікається. Викликай після `buildingObjs` (воно скидає вогні).
 */
export function campfireObjs(scene: Scene, rt: Rt): { objs: { row: number; obj: Obj }[]; smokers: Smoker[] } {
  const objs: { row: number; obj: Obj }[] = [], smokers: Smoker[] = [];
  for (const hall of rt.buildings) {
    if (hall.kind !== 'townhall' || hall.progress < 1) continue;
    const f = campfireOf(scene.w, hall), art = buildingArt('campfire', CAMP_TILES, CAMP_TILES, TILE), a = art.spr;
    const x0 = (f.x - CAMP_TILES / 2) * TILE, y0 = (f.y - CAMP_TILES / 2) * TILE, edge = y0 + CAMP_TILES * TILE;
    const corner = planeToIso(x0, edge, 0), s = new Sprite(a.tex);
    s.anchor.set(a.ax / a.w, a.ay / a.h); s.scale.set(a.scale); s.position.set(corner.x, corner.y); s.zIndex = edge;
    for (const l of art.fx.lights) { const q = planeToIso(x0 + l.x, y0 + l.y, l.z); scene.atmo.addLight(q.x, q.y, l.r, l.rgb, l.a, 0.8); }
    for (const m of art.fx.smoke) smokers.push({ x: x0 + m.x, y: y0 + m.y, z: m.z });
    objs.push({ row: rowOf(Math.floor(edge / TILE) - 1), obj: { tile: null, pick: null, sel: null, sprites: [s] } });
  }
  return { objs, smokers };
}
