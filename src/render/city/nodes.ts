import { Sprite } from 'pixi.js';
import { SECTOR_CELLS, isActiveCell } from '../../shared';
import { NODE_TREE, nodeTile } from '../../sim';
import { STONE_TILES } from '../../sim/balance';
import { genBorderNode, mixNodeSeed } from '../../sim/nodegen';
import { planeToIso } from '../projection';
import { OAK_VARIANTS, PINE_VARIANTS, ROCK_VARIANTS, spr, treeSpriteId, variant } from '../style';
import { TILE, rowOf, type Obj, type Rt } from './scene';

/** Вузли ресурсів (дерева, каміння) як об'єкти шарів глибини: спрайт, полігон влучання, виділення. */

/** Об'єкт-вузол ресурсу в клітинці (cx, cy) або null. Рядок шару глибини — за тайлом-якорем вузла. */
export function nodeObj(rt: Rt, seed: number, sector: number, cx: number, cy: number): { row: number; obj: Obj } | null {
  const i = cy * SECTOR_CELLS + cx, border = !isActiveCell(cx, cy);
  const kind = border ? genBorderNode(mixNodeSeed(seed, sector), cx, cy) : rt.kind[i];
  if (!kind) return null;
  const res = build(rt, seed, sector, cx, cy, kind, border);
  if (res && border) { res.obj.sel = null; res.obj.pick = null; } // неактивна смуга: лише вигляд
  return res;
}

function build(rt: Rt, seed: number, sector: number, cx: number, cy: number, kind: number, border: boolean): { row: number; obj: Obj } | null {
  const i = cy * SECTOR_CELLS + cx;
  const nt = nodeTile(seed, sector, cx, cy), grown = border || rt.amount[i] > 0;
  const px = (nt.x + 0.5) * TILE, py = (nt.y + 0.5) * TILE, tile = { x: nt.x, y: nt.y };
  const base = planeToIso(px, py, 0);
  const row = rowOf(nt.y);
  const mk = (id: string, flip: boolean): Sprite => {
    const a = spr(id), s = new Sprite(a.tex);
    s.anchor.set(a.ax / a.w, a.ay / a.h); s.scale.set(flip ? -a.scale : a.scale, a.scale);
    s.position.set(base.x, base.y); s.zIndex = py;
    return s;
  };
  if (kind === NODE_TREE) {
    const flip = variant(cx, cy, 2, 5) === 1;
    const id = grown ? treeSpriteId(cx, cy, OAK_VARIANTS, PINE_VARIANTS) : (variant(cx, cy, 2, 9) ? 'stump' : 'sapling');
    const a = spr(id), rw = (a.w * a.scale) * 0.32, hh = (a.ay * a.scale) * 0.92;
    return { row, obj: {
      tile, sel: grown ? { t: 'node', cx, cy } : null, sprites: [mk(id, flip)],
      pick: grown ? [base.x - rw, base.y - hh, base.x + rw, base.y - hh, base.x + rw * 0.4, base.y + 2, base.x - rw * 0.4, base.y + 2] : null,
    } };
  }
  const id = grown ? `rock${variant(cx, cy, ROCK_VARIANTS, 4)}` : 'rubble', a = spr(id), rw = (STONE_TILES * TILE) / 2;
  return { row, obj: {
    tile, sel: { t: 'node', cx, cy }, sprites: [mk(id, variant(cx, cy, 2, 6) === 1)],
    pick: [base.x - rw, base.y - a.ay * a.scale * 0.8, base.x + rw, base.y - a.ay * a.scale * 0.8, base.x + rw, base.y + 2, base.x - rw, base.y + 2],
  } };
}
