import { Sprite, type Container } from 'pixi.js';
import { ANIMAL_MODE, type AnimalKind } from '../shared';
import { CARCASS_TICKS, type SimWorld } from '../sim';
import { ANIMAL_IDLE_FRAMES, animalFrameId, animalWalkFrame, cycleFrame, spr } from './style';
import { lerpPos } from './interp';
import { planeToIso } from './projection';
import type { Particles } from './style';

interface Vis { s: Sprite; lx: number; ly: number; dist: number; dir: number; key: string; row: number }

/** Дикі звірі в місті: спрайти з пулу в шарах глибини (як жителі), ходьба за пройденою відстанню, тушки. */
export class FaunaLayer {
  private vis = new Map<number, Vis>();
  constructor(private rows: Container[], private tile: number, private bucket: number, private nb: number) {}

  get count(): number { return this.vis.size; }

  update(w: SimWorld, sector: number, alpha: number, animT: number, parts: Particles, dt: number, zoomOk: boolean): void {
    const seen = new Set<number>();
    for (const a of w.state.fauna.animals) {
      if (a.sector !== sector) continue;
      seen.add(a.id);
      const tx = lerpPos(a.px, a.x, alpha), ty = lerpPos(a.py, a.y, alpha);
      const px = tx * this.tile, py = ty * this.tile;
      const row = Math.min(this.nb - 1, Math.max(0, Math.floor(ty / this.bucket)));
      let v = this.vis.get(a.id);
      if (!v) {
        const s = new Sprite(spr(animalFrameId(a.kind, 'idle', 0)).tex);
        v = { s, lx: px, ly: py, dist: a.id * 5.3, dir: a.id % 2 ? 1 : -1, key: '', row: -1 };
        this.vis.set(a.id, v);
      }
      const moved = Math.hypot(px - v.lx, py - v.ly) / this.tile * 2; // у «текселях» кроку
      if (Math.abs(px - v.lx) > 0.02) v.dir = px > v.lx ? 1 : -1;
      v.lx = px; v.ly = py; v.dist += moved;
      const dead = a.mode === ANIMAL_MODE.dead, walking = !dead && moved > 0.04;
      const id = dead ? animalFrameId(a.kind, 'dead', 0)
        : walking ? animalFrameId(a.kind, 'walk', animalWalkFrame(a.kind, v.dist))
        : animalFrameId(a.kind, 'idle', cycleFrame(animT + a.id * 0.83, 0.35, ANIMAL_IDLE_FRAMES));
      const t = spr(id);
      if (v.key !== id) { v.s.texture = t.tex; v.s.anchor.set(t.ax / t.w, t.ay / t.h); v.key = id; }
      v.s.scale.set(t.scale * v.dir, t.scale);
      v.s.alpha = dead ? Math.min(1, a.timer / 60) * (a.timer > CARCASS_TICKS - 5 ? 1 : 1) : 1;
      const base = planeToIso(px, py, 0);
      v.s.position.set(base.x, base.y); v.s.zIndex = py;
      if (v.row !== row) { this.rows[row].addChild(v.s); v.row = row; }
      if (a.mode === ANIMAL_MODE.flee && zoomOk && Math.random() < dt * 5) {
        parts.emit({ x: px, y: py, z: 0.5, vx: (Math.random() - 0.5) * 6, vz: 4, g: 8, life: 0.4, col: 0xc9b48a, size: 0.7, a: 0.45, kind: 'dust' });
      }
    }
    for (const [id, v] of this.vis) if (!seen.has(id)) { v.s.destroy(); this.vis.delete(id); }
  }

  /** Тип звіра під курсором тощо — на майбутнє (вибір/інфо). */
  kindOf(id: number, w: SimWorld): AnimalKind | null { return w.state.fauna.animals.find((a) => a.id === id)?.kind ?? null; }
}
