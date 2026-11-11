import { Container, Sprite } from 'pixi.js';
import { LOD_CONFIG } from './lod';
import { planeToIso, screenToPlane, type Camera } from './projection';
import { TUFT_VARIANTS, spr, variant } from './style';

/**
 * Пучки трави, що колишуться. Живуть лише у видимій частині екрана й лише при близькому зумі (LOD `grass`):
 * пул спрайтів ≤ `maxGrass`, густина тримається сталою за рахунок кроку сітки (степ подвоюється разом із площею огляду).
 */
export class GrassLayer {
  readonly layer = new Container();
  private pool: { s: Sprite; ph: number }[] = [];
  private active = 0;
  private sig = '';

  get count(): number { return this.active; }

  /** `free(px, py)` — чи можна ставити пучок у цій точці площини (не вода, не дорога). */
  update(cam: Camera, w: number, h: number, t: number, on: boolean, free: (px: number, py: number) => boolean): void {
    if (!on) { if (this.active) this.hideAll(); return; }
    this.layer.visible = true;
    const a = screenToPlane(0, 0, cam), b = screenToPlane(w, h, cam);
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    const area = (x1 - x0) * (y1 - y0);
    // крок сітки: 10·2^k, щоб кількість пучків ≲ maxGrass і не «стрибала» при зумі
    const step = 10 * 2 ** Math.max(0, Math.ceil(Math.log2(Math.sqrt(area / LOD_CONFIG.maxGrass) / 10)));
    const sig = `${step}|${Math.floor(x0 / step)}|${Math.floor(y0 / step)}|${Math.ceil(x1 / step)}|${Math.ceil(y1 / step)}`;
    if (sig !== this.sig) {
      this.sig = sig;
      let n = 0;
      for (let gy = Math.floor(y0 / step); gy <= Math.ceil(y1 / step) && n < LOD_CONFIG.maxGrass; gy++) {
        for (let gx = Math.floor(x0 / step); gx <= Math.ceil(x1 / step) && n < LOD_CONFIG.maxGrass; gx++) {
          if (variant(gx, gy, 100, 17) >= 45) continue;
          const px = (gx + variant(gx, gy, 7, 2) / 7) * step, py = (gy + variant(gx, gy, 7, 5) / 7) * step;
          if (!free(px, py)) continue;
          let p = this.pool[n];
          if (!p) {
            const s = new Sprite(); this.layer.addChild(s); p = { s, ph: 0 }; this.pool.push(p);
          }
          const id = spr(`tuft${variant(gx, gy, TUFT_VARIANTS, 9)}`), q = planeToIso(px, py, 0);
          p.s.texture = id.tex; p.s.anchor.set(id.ax / id.w, id.ay / id.h); p.s.scale.set(id.scale * (1 + variant(gx, gy, 4, 1) * 0.15));
          p.s.position.set(q.x, q.y); p.ph = variant(gx, gy, 628, 4) / 100; p.s.visible = true;
          n++;
        }
      }
      for (let i = n; i < this.pool.length; i++) this.pool[i].s.visible = false;
      this.active = n;
    }
    const amp = LOD_CONFIG.grassSwayAmp;
    for (let i = 0; i < this.active; i++) { const p = this.pool[i]; p.s.skew.x = Math.sin(t * 1.9 + p.ph) * amp; }
  }

  private hideAll(): void { this.layer.visible = false; this.active = 0; this.sig = ''; }
}
