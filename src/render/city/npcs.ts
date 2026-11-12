import { Graphics, Sprite } from 'pixi.js';
import { NPC_STAT_COUNT, PROFESSIONS, RESOURCE_KINDS, TASKS, statIndex } from '../../shared';
import { lerpPos } from '../interp';
import { planeToIso } from '../projection';
import { IDLE_FRAMES, actFrames, actRate, classOf, cycleFrame, frameId, hitFrame, spr, toolOf, walkFrame } from '../style';
import { drawFishing } from './fishingFx';
import { emitHit } from './fx';
import { TILE, rowOf, type Scene } from './scene';

/** Візуал жителя: спрайт, ноша, лічильники анімації. */
export interface NpcVis { s: Sprite; carry: Sprite; lx: number; ly: number; dist: number; dir: number; frame: number; row: number; fish?: number }

const WORK_TASK = TASKS.indexOf('work');
const SIZE_STAT = statIndex('size');
const RES_BUNDLE: Record<string, string> = { wood: 'wood', stone: 'stone', planks: 'planks', food: 'food' };

/** Жителі: спрайти з пулу; кадр — ходьба (за відстанню), дія (за часом) або спокій. Ноги й тіло — один кадр, тож не розходяться. */
export class NpcLayer {
  /** Ліски й поплавки рибалок (поверх шарів глибини). */
  readonly fishG = new Graphics();
  private vis = new Map<number, NpcVis>();

  get count(): number { return this.vis.size; }

  draw(scene: Scene, dt: number): void {
    const n = scene.w.state.npcs, npc = scene.w.npc, alpha = scene.clock.alpha(performance.now());
    const seen = new Set<number>();
    const zoomOk = scene.cam.zoom > 0.45;
    const fg = this.fishG; fg.clear();
    for (let i = 0; i < n.capacity; i++) {
      if (!n.alive[i] || n.sector[i] !== scene.sector) continue;
      seen.add(i);
      const tx = lerpPos(npc.px[i], n.x[i], alpha), ty = lerpPos(npc.py[i], n.y[i], alpha);
      const px = tx * TILE, py = ty * TILE, row = rowOf(ty);
      let v = this.vis.get(i);
      if (!v) {
        const s = new Sprite(spr(frameId('civ', 'idle', 0)).tex), c = new Sprite(spr('bundle_wood').tex);
        s.anchor.set(0.5); c.anchor.set(0.5, 1);
        v = { s, carry: c, lx: px, ly: py, dist: i * 3.7, dir: 1, frame: -1, row: -1 };
        this.vis.set(i, v);
      }
      const moved = Math.hypot(px - v.lx, py - v.ly);
      if (Math.abs(px - v.lx) > 0.05) v.dir = px > v.lx ? 1 : -1;
      v.lx = px; v.ly = py; v.dist += moved;
      const cls = classOf(PROFESSIONS[n.profession[i]] ?? 'idle'), tool = toolOf(cls);
      const working = n.task[i] === WORK_TASK && moved < 0.05, walking = !working && moved > 0.02;
      let anim: 'idle' | 'walk' | 'act', fi: number;
      if (working && actFrames(tool)) { anim = 'act'; fi = cycleFrame(scene.animT + i * 0.37, actRate(tool), actFrames(tool)); }
      else if (walking) { anim = 'walk'; fi = walkFrame(v.dist); }
      else { anim = 'idle'; fi = cycleFrame(scene.animT + i * 0.61, 0.6, IDLE_FRAMES); }
      const key = (anim === 'act' ? 200 : anim === 'walk' ? 100 : 0) + fi + (cls.length * 1000);
      const a = spr(frameId(cls, anim, fi));
      if (v.frame !== key) {
        v.s.texture = a.tex; v.s.anchor.set(a.ax / a.w, a.ay / a.h);
        if (anim === 'act' && fi === hitFrame(tool) && zoomOk) emitHit(scene.parts, tool, px, py, v.dir);
        v.frame = key;
      }
      const small = n.stats[i * NPC_STAT_COUNT + SIZE_STAT] < 2 ? 0.82 : 1;
      const base = planeToIso(px, py, 0);
      if (tool === 'rod' && anim === 'act') drawFishing(scene, fg, v, i, tx, ty, fi, a.scale * small, base);
      v.s.scale.set(a.scale * small * v.dir, a.scale * small);
      v.s.position.set(base.x, base.y); v.s.zIndex = py;
      if (v.row !== row) { scene.rowCont[row].addChild(v.s, v.carry); v.row = row; }
      if (walking && zoomOk && Math.random() < dt * 4) scene.parts.emit({ x: px, y: py, z: 0.5, vx: (Math.random() - 0.5) * 6, vz: 4, g: 8, life: 0.45, col: 0xc9b48a, size: 0.7, a: 0.5, kind: 'dust' });
      // ноша над головою: колоди/камінь/дошки/їжа; оброблене дерево — дошки
      if (n.carryAmount[i]) {
        const kind = RESOURCE_KINDS[n.carryKind[i]] ?? 'wood', done = npc.stage[i] === 1;
        const id = `bundle_${RES_BUNDLE[done && kind === 'wood' ? 'planks' : kind] ?? 'sack'}`, b = spr(id), lvl = n.carryAmount[i] >= 4 ? 1.5 : n.carryAmount[i] >= 2 ? 1.25 : 1;
        v.carry.texture = b.tex; v.carry.scale.set(b.scale * lvl * small); v.carry.visible = true;
        v.carry.position.set(base.x, base.y - 21 * a.scale * small); v.carry.zIndex = py + 0.01;
      } else v.carry.visible = false;
    }
    for (const [i, v] of this.vis) if (!seen.has(i)) { v.s.destroy(); v.carry.destroy(); this.vis.delete(i); }
  }
}
