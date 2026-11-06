import { Container, Graphics, Text } from 'pixi.js';
import { planeToIso } from './projection';

const GROUND_OK = 0x8fd3ff, GROUND_BAD = 0xff5050, BAD = 0xff5050;
const mix = (a: number, b: number, t: number): number => {
  const f = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (f(16) << 16) | (f(8) << 8) | f(0);
};

/** Напівпрозорий «привид» будівлі під курсором: та сама форма й ізо-проєкція, що в готової споруди, зелений/червоний тінт. */
export class BuildingGhost {
  readonly g = new Graphics();
  /** Контур footprint на землі: лежить НИЖЧЕ за все (одразу над землею), щоб не перекривати голограму. */
  readonly base = new Graphics();
  readonly label = (() => { const t = new Text({ text: '', style: { fontSize: 12, fill: 0xffffff, stroke: { color: 0x000000, width: 3 }, fontFamily: 'sans-serif' } }); t.anchor.set(0.5, 0); return t; })();
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
    // Земля: власний колір (світло-блакитна площина, червона при забороні). Тіло: кольори самої будівлі з легким тінтом, грані різної яскравості.
    const gnd = ok ? GROUND_OK : GROUND_BAD;
    const tintK = ok ? 0.08 : 0.35, tint = ok ? 0xffffff : BAD;
    const front = mix(mix(color, tint, tintK), 0x000000, 0.12), right = mix(mix(color, tint, tintK), 0x000000, 0.38), top = mix(mix(color, tint, tintK), 0xffffff, 0.3);
    const g = this.g;
    g.clear();
    g.visible = true;
    const b = this.base;
    b.clear();
    b.visible = true;
    b.poly(flat(P(x0, y0, 0), P(x0 + bw, y0, 0), P(x0 + bw, y0 + bh, 0), P(x0, y0 + bh, 0))).fill({ color: gnd, alpha: 0.32 }).stroke({ width: 1.5, color: ok ? 0xffffff : BAD, alpha: 0.9 });
    const line = { width: 1, color: 0x000000, alpha: 0.55 };
    g.poly(flat(P(x0, y0 + bh, height), P(x0 + bw, y0 + bh, height), P(x0 + bw, y0 + bh, 0), P(x0, y0 + bh, 0))).fill({ color: front, alpha: 0.62 }).stroke(line);
    g.poly(flat(P(x0 + bw, y0, height), P(x0 + bw, y0 + bh, height), P(x0 + bw, y0 + bh, 0), P(x0 + bw, y0, 0))).fill({ color: right, alpha: 0.62 }).stroke(line);
    g.poly(flat(P(x0, y0, height), P(x0 + bw, y0, height), P(x0 + bw, y0 + bh, height), P(x0, y0 + bh, height))).fill({ color: top, alpha: 0.62 }).stroke(line);
    // Підпис розміру футпринту (у тайлах) під передньою гранню
    const lp = P(x0 + bw / 2, y0 + bh, 0), txt = `${size.w}×${size.h}`;
    if (this.label.text !== txt) this.label.text = txt;
    this.label.position.set(lp.x, lp.y + 4);
    if (this.label.parent !== g) g.addChild(this.label);
  }

  hide(): void { this.g.visible = false; this.base.visible = false; }
  destroy(): void { this.g.destroy(); }
}
