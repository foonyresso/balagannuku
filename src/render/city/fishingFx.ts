import type { Graphics } from 'pixi.js';
import { SECTOR_SIZE } from '../../shared';
import { getSectorRt } from '../../sim';
import { planeToIso } from '../projection';
import { hitFrame, rodAngle, rodTip } from '../style';
import { bobberAt, nearestWater } from './fishing';
import type { NpcVis } from './npcs';
import { TILE, type Scene } from './scene';

/** Рибалка: стоїть обличчям до води, ліска тягнеться від кінчика вудки до поплавка на воді. Геометрія — fishing.ts. */
export function drawFishing(scene: Scene, g: Graphics, v: NpcVis, i: number, tx: number, ty: number, fi: number, sc: number, base: { x: number; y: number }): void {
  const rt = getSectorRt(scene.w, scene.sector), T = SECTOR_SIZE, animT = scene.animT;
  const water = nearestWater((x, y) => x >= 0 && y >= 0 && x < T && y < T && rt.water[y * T + x] === 1, tx, ty);
  if (!water) return;
  if (Math.abs(water.x - tx) > 0.2) v.dir = water.x > tx ? 1 : -1;
  const tip = rodTip(rodAngle(fi), fi === hitFrame('rod') ? 1 : 0);
  const sx = base.x + tip.x * sc * v.dir, sy = base.y + tip.y * sc;
  const bob = bobberAt({ x: tx, y: ty }, water, animT + i * 0.9);
  const castT = fi < 3 ? 0 : 1; // до кидка: поплавка ще немає
  const bp = planeToIso(bob.x * TILE, bob.y * TILE, bob.z * TILE);
  const bite = fi === 7 || (fi === 6 && Math.sin(animT * 14 + i) > 0.3);
  if (castT) {
    const mid = { x: (sx + bp.x) / 2, y: Math.max(sy, bp.y) + (fi === 3 ? 2 : 4) * sc * 3 * (bite ? 0.3 : 1) };
    g.moveTo(sx, sy).quadraticCurveTo(mid.x, mid.y, bp.x, bp.y).stroke({ width: 0.7, color: 0xe6e2d6, alpha: 0.85 });
    g.circle(bp.x, bp.y, 1.5).fill(0xf1eada); g.circle(bp.x, bp.y - 0.9, 1.1).fill(0xc2323c);
    g.ellipse(bp.x, bp.y + 1.2, 3.2 + (bite ? 1.5 : 0), 1.1).stroke({ width: 0.5, color: 0xdff2fa, alpha: 0.6 });
  } else {
    g.moveTo(sx, sy).lineTo(sx + 1.5 * v.dir, sy + 7 * sc * 3).stroke({ width: 0.7, color: 0xe6e2d6, alpha: 0.7 });
  }
  if ((fi === hitFrame('rod') || fi === 7) && v.fish !== fi + 100 * Math.floor(animT * 0.2)) {
    v.fish = fi + 100 * Math.floor(animT * 0.2);
    if (scene.cam.zoom > 0.45) for (let k = 0; k < (fi === 7 ? 9 : 5); k++) scene.parts.emit({ x: bob.x * TILE, y: bob.y * TILE, z: 1, vx: (Math.random() - 0.5) * 14, vy: (Math.random() - 0.5) * 6, vz: 10 + Math.random() * 12, g: 70, life: 0.5, col: 0xdff2fa, size: 0.7, kind: 'chip' });
  }
}
