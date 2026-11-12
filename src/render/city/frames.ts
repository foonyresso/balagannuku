import type { Graphics } from 'pixi.js';
import { NPC_TILES, STONE_TILES } from '../../sim/balance';
import type { Sel } from '../../ui/info';
import { planeToIso } from '../projection';
import { posOf } from './picking';
import { TILE, quad, type Scene } from './scene';

/** Рамка виділення: кільце навколо жителя, контур footprint для споруди, овал для ресурсу, тайл для дороги. */
export function drawFrame(scene: Scene, g: Graphics, sel: Sel, color: number, alpha: number): void {
  const pos = posOf(scene, sel);
  if (!pos) return;
  const st = { width: 2, color, alpha };
  if (sel.t === 'group') { for (const i of sel.items.slice(0, 200)) drawFrame(scene, g, i, color, alpha); return; }
  if (sel.t === 'npc') {
    const c = planeToIso(pos.x * TILE, pos.y * TILE, 0), hw = (NPC_TILES * TILE) / 2;
    g.ellipse(c.x, c.y, hw * 1.7, hw * 0.85).stroke(st);
  } else if (sel.t === 'building') {
    const b = scene.w.byId.get(sel.id)!;
    g.poly(quad(b.cell.x - 0.5, b.cell.y - 0.5, b.size.w + 1, b.size.h + 1)).fill({ color, alpha: 0.12 * alpha }).stroke(st);
  } else if (sel.t === 'node') {
    const c = planeToIso(pos.x * TILE, pos.y * TILE, 0), r = (STONE_TILES * TILE) / 2;
    g.ellipse(c.x, c.y, r, r * 0.5).stroke(st);
  } else g.poly(quad(sel.x, sel.y, 1, 1)).fill({ color, alpha: 0.3 * alpha }).stroke(st);
}
