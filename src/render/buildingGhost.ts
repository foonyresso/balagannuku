import { Container, Graphics } from 'pixi.js';
import { planeToIso } from './projection';

const OK = 0x66ff66, BAD = 0xff5050;
const mix = (a: number, b: number, t: number): number => {
  const f = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (f(16) << 16) | (f(8) << 8) | f(0);
};

/** Напівпрозорий «привид» будівлі під курсором: та сама форма й ізо-проєкція, що в готової споруди, зелений/червоний тінт. */
export class BuildingGhost {
  readonly g = new Graphics();
  /** Контур footprint на землі: лежить НИЖЧЕ за все (одразу над землею), щоб не перекривати голограму. */
  readonly base = new Graphics();
  private bucket = -1;
  private after: Graphics | null = null;

  /** Малює привид; `after` — шар глибини (Graphics), одразу над яким він має лежати в `root`, щоб правильно перекриватись з оточенням. */
  show(root: Container, ground: Container, after: Graphics, bucket: number, cell: { x: number; y: number }, size: { w: number; h: number }, tile: number, height: number, color: number, ok: boolean): void {
    if (bucket !== this.bucket || after !== this.after || this.g.parent !== root) {
      if (this.g.parent) this.g.parent.removeChild(this.g);
      root.addChildAt(this.g, root.getChildIndex(after) + 1);
      this.bucket = bucket; this.after = after;
    }
    if (this.base.parent !== root) root.addChildAt(this.base, root.getChildIndex(ground) + 1);
    const x0 = cell.x * tile, y0 = cell.y * tile, bw = size.w * tile, bh = size.h * tile;
    const P = (x: number, y: number, z: number) => planeToIso(x, y, z);
    const flat = (...p: { x: number; y: number }[]) => p.flatMap((v) => [v.x, v.y]);
    const tint = ok ? OK : BAD;
    const side = mix(color, tint, 0.55), top = mix(mix(color, 0xffffff, 0.25), tint, 0.55);
    const g = this.g;
    g.clear();
    g.visible = true;
    const b = this.base;
    b.clear();
    b.visible = true;
    b.poly(flat(P(x0, y0, 0), P(x0 + bw, y0, 0), P(x0 + bw, y0 + bh, 0), P(x0, y0 + bh, 0))).fill({ color: tint, alpha: 0.18 }).stroke({ width: 1, color: tint, alpha: 0.7 });
    g.poly(flat(P(x0, y0 + bh, height), P(x0 + bw, y0 + bh, height), P(x0 + bw, y0 + bh, 0), P(x0, y0 + bh, 0))).fill({ color: side, alpha: 0.5 }).stroke({ width: 1, color: tint, alpha: 0.8 });
    g.poly(flat(P(x0 + bw, y0, height), P(x0 + bw, y0 + bh, height), P(x0 + bw, y0 + bh, 0), P(x0 + bw, y0, 0))).fill({ color: mix(side, 0x000000, 0.2), alpha: 0.5 }).stroke({ width: 1, color: tint, alpha: 0.8 });
    g.poly(flat(P(x0, y0, height), P(x0 + bw, y0, height), P(x0 + bw, y0 + bh, height), P(x0, y0 + bh, height))).fill({ color: top, alpha: 0.5 }).stroke({ width: 1, color: tint, alpha: 0.8 });
  }

  hide(): void { this.g.visible = false; this.base.visible = false; }
  destroy(): void { this.g.destroy(); }
}
