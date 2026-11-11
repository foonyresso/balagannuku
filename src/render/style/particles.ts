import { Container, Sprite, Texture } from 'pixi.js';
import { planeToIso } from '../projection';

/** Частинки (тріски, іскри, дим, стріли): спрайти з пулу в координатах площини з висотою z. */
export type ParticleKind = 'chip' | 'spark' | 'smoke' | 'dust' | 'arrow' | 'glow';
interface P { s: Sprite; x: number; y: number; z: number; vx: number; vy: number; vz: number; g: number; life: number; max: number; size: number; a: number; kind: ParticleKind; live: boolean }

export interface Emit {
  x: number; y: number; z: number; vx?: number; vy?: number; vz?: number; g?: number; life: number; col: number; size?: number; a?: number; kind?: ParticleKind;
}
const MAX = 700;

export class Particles {
  readonly layer = new Container();
  private pool: P[] = [];
  private live = 0;
  constructor() { this.layer.sortableChildren = false; }

  get count(): number { return this.live; }

  emit(o: Emit): void {
    let p = this.pool.find((q) => !q.live);
    if (!p) {
      if (this.pool.length >= MAX) return;
      const s = new Sprite(Texture.WHITE); s.anchor.set(0.5); this.layer.addChild(s);
      p = { s, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, g: 0, life: 0, max: 1, size: 1, a: 1, kind: 'chip', live: false };
      this.pool.push(p);
    }
    Object.assign(p, { x: o.x, y: o.y, z: o.z, vx: o.vx ?? 0, vy: o.vy ?? 0, vz: o.vz ?? 0, g: o.g ?? 0, life: o.life, max: o.life, size: o.size ?? 1, a: o.a ?? 1, kind: o.kind ?? 'chip', live: true });
    p.s.tint = o.col; p.s.visible = true; this.live++;
    p.s.blendMode = p.kind === 'glow' || p.kind === 'spark' ? 'add' : 'normal';
  }

  update(dt: number): void {
    for (const p of this.pool) {
      if (!p.live) continue;
      p.life -= dt;
      if (p.life <= 0) { p.live = false; p.s.visible = false; this.live--; continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vz -= p.g * dt; p.z += p.vz * dt;
      if (p.z < 0 && (p.kind === 'chip' || p.kind === 'dust')) { p.z = 0; p.vz = 0; p.vx = 0; p.vy = 0; }
      const i = planeToIso(p.x, p.y, p.z), a = Math.max(0, p.life / p.max) * p.a;
      p.s.position.set(i.x, i.y);
      p.s.alpha = p.kind === 'smoke' ? a * (1 - a * 0.5) : a;
      const sz = p.kind === 'smoke' ? p.size * (1 + (1 - a) * 3) : p.size;
      if (p.kind === 'arrow') { p.s.width = 2.6; p.s.height = 0.5; p.s.scale.x = Math.sign(p.vx || 1) * Math.abs(p.s.scale.x); } else { p.s.width = sz; p.s.height = sz; }
    }
  }
  clear(): void { for (const p of this.pool) { p.live = false; p.s.visible = false; } this.live = 0; }
}
