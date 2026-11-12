import { planeToIso } from '../projection';
import type { Particles, Tool } from '../style';
import type { Smoker } from './buildings';
import type { Scene } from './scene';

/** Частинки міста: удари інструментів і дим споруд. */

/** Удар інструмента: тріски, іскри, пил, стріла. */
export function emitHit(P: Particles, tool: Tool, px: number, py: number, dir: number): void {
  const r = Math.random;
  const burst = (n: number, o: (k: number) => Parameters<Particles['emit']>[0]) => { for (let k = 0; k < n; k++) P.emit(o(k)); };
  if (tool === 'axe') burst(7, (k) => ({ x: px + dir * 5, y: py, z: 5, vx: dir * (6 + r() * 12), vz: 12 + r() * 14, g: 90, life: 0.6, col: k % 2 ? 0xd9b27a : 0x8a6238, size: 0.6 }));
  else if (tool === 'pick') burst(6, () => ({ x: px + dir * 5, y: py, z: 3, vx: dir * (4 + r() * 14), vz: 8 + r() * 14, g: 80, life: 0.35, col: 0xffe08a, size: 0.6, kind: 'spark' }));
  else if (tool === 'hammer' || tool === 'sword') burst(4, () => ({ x: px + dir * 5, y: py, z: 3, vx: dir * (4 + r() * 10), vz: 8 + r() * 10, g: 70, life: 0.35, col: 0xffe08a, size: 0.6, kind: 'spark' }));
  else if (tool === 'hoe') burst(5, () => ({ x: px + dir * 6, y: py, z: 1, vx: dir * (3 + r() * 6), vz: 5 + r() * 6, g: 40, life: 0.5, col: 0x8a6a3e, size: 0.7 }));
  else if (tool === 'bow') P.emit({ x: px + dir * 3, y: py + 0.01, z: 6, vx: dir * 150, vz: 7, g: 40, life: 0.55, col: 0xe6dcc0, size: 1, kind: 'arrow' });
}

/** Дим із димарів і похідних вогнищ (лише у видимій частині екрана). */
export function emitSmoke(scene: Scene, smokers: readonly Smoker[], dt: number): void {
  const { cam } = scene, w = scene.app.screen.width, h = scene.app.screen.height;
  for (const m of smokers) {
    if (Math.random() > dt * 1.2) continue;
    const q = planeToIso(m.x, m.y, m.z), sx = q.x * cam.zoom + cam.x, sy = q.y * cam.zoom + cam.y;
    if (sx < -50 || sx > w + 50 || sy < -80 || sy > h + 50) continue;
    scene.parts.emit({ x: m.x, y: m.y, z: m.z, vx: 2 + Math.random() * 2, vz: 5 + Math.random() * 3, life: 3, col: 0x9a96a0, size: 1.2, a: 0.4, kind: 'smoke' });
  }
}
