import { Sprite } from 'pixi.js';
import { planeToIso } from '../projection';
import { buildingArt } from '../style';
import { TILE, rowOf, type Obj, type Rt, type Scene } from './scene';

/** Димар чи вогнище: точка, з якої йде дим (одиниці площини). */
export interface Smoker { x: number; y: number; z: number }

/**
 * Споруди сектора як об'єкти шарів глибини. Заодно виставляє вогні споруд в атмосфері.
 * `flat` — плоскі спрайти під об'єктами (поле ферми), `smokers` — джерела диму.
 */
export function buildingObjs(scene: Scene, rt: Rt): { objs: { row: number; obj: Obj }[]; flat: Sprite[]; smokers: Smoker[] } {
  const objs: { row: number; obj: Obj }[] = [], flat: Sprite[] = [], smokers: Smoker[] = [];
  scene.atmo.clearLights();
  for (const b of rt.buildings) {
    const art = buildingArt(b.kind, b.size.w, b.size.h, TILE), a = art.spr;
    const x0 = b.cell.x * TILE, y0 = b.cell.y * TILE, bw = b.size.w * TILE, bh = b.size.h * TILE;
    const corner = planeToIso(x0, y0 + bh, 0), s = new Sprite(a.tex);
    s.anchor.set(a.ax / a.w, a.ay / a.h); s.scale.set(a.scale); s.position.set(corner.x, corner.y); s.zIndex = y0 + bh;
    const pad = 8 * a.scale, topY = corner.y - (a.ay - 8) * a.scale;
    const pick = [corner.x - pad, topY, corner.x + bw + pad, topY, corner.x + bw + pad, corner.y + 2, corner.x - pad, corner.y + 2];
    for (const l of art.fx.lights) { const q = planeToIso(x0 + l.x, y0 + l.y, l.z); scene.atmo.addLight(q.x, q.y, l.r, l.rgb, l.a, 0.8); }
    for (const m of art.fx.smoke) smokers.push({ x: x0 + m.x, y: y0 + m.y, z: m.z });
    if (b.kind === 'farm') {
      const f = buildingArt('farm_field', b.size.w, b.size.h, TILE).spr, fs = new Sprite(f.tex);
      fs.anchor.set(f.ax / f.w, f.ay / f.h); fs.scale.set(f.scale); fs.position.set(corner.x, corner.y);
      flat.push(fs);
    }
    objs.push({ row: rowOf(b.cell.y + b.size.h - 1), obj: { tile: b.cell, pick, sel: { t: 'building', id: b.id }, sprites: [s] } });
  }
  return { objs, flat, smokers };
}
