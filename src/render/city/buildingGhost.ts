import { Container, Graphics, Sprite } from 'pixi.js';
import { planeToIso } from '../projection';
import { buildingArt } from '../style';

const GROUND_OK = 0x8fd3ff, GROUND_BAD = 0xff5050, BAD = 0xff5050;

/** Напівпрозорий «привид» будівлі під курсором: справжній спрайт споруди (та сама проєкція), зелений/червоний тінт. */
export class BuildingGhost {
  /** Контейнер зі спрайтом споруди (лежить у шарі глибини, щоб правильно перекриватись з оточенням). */
  readonly g = new Container();
  /** Контур footprint на землі: лежить НИЖЧЕ за все (одразу над землею), щоб не перекривати голограму. */
  readonly base = new Graphics();
  private sprite = new Sprite();
  private bucket = -1;
  private after: Container | null = null;

  constructor() { this.g.addChild(this.sprite); }

  /** Малює привид; `after` — шар глибини, одразу над яким він має лежати в `root`. */
  show(root: Container, ground: Container, after: Container, bucket: number, cell: { x: number; y: number }, size: { w: number; h: number }, tile: number, kind: string, ok: boolean): void {
    if (bucket !== this.bucket || after !== this.after || this.g.parent !== root) {
      if (this.g.parent) this.g.parent.removeChild(this.g);
      root.addChildAt(this.g, root.getChildIndex(after) + 1);
      this.bucket = bucket; this.after = after;
    }
    if (this.base.parent !== root) root.addChildAt(this.base, root.getChildIndex(ground) + 1);
    const x0 = cell.x * tile, y0 = cell.y * tile, bw = size.w * tile, bh = size.h * tile;
    const P = (x: number, y: number, z: number) => planeToIso(x, y, z);
    const flat = (...p: { x: number; y: number }[]) => p.flatMap((v) => [v.x, v.y]);
    this.g.visible = true;
    const art = buildingArt(kind, size.w, size.h, tile).spr, c = P(x0, y0 + bh, 0);
    this.sprite.texture = art.tex; this.sprite.anchor.set(art.ax / art.w, art.ay / art.h);
    this.sprite.scale.set(art.scale); this.sprite.position.set(c.x, c.y);
    this.sprite.tint = ok ? 0xd8ffe0 : 0xff7070; this.sprite.alpha = 0.78;
    const b = this.base;
    b.clear();
    b.visible = true;
    b.poly(flat(P(x0, y0, 0), P(x0 + bw, y0, 0), P(x0 + bw, y0 + bh, 0), P(x0, y0 + bh, 0))).fill({ color: ok ? GROUND_OK : GROUND_BAD, alpha: 0.32 }).stroke({ width: 1.5, color: ok ? 0xffffff : BAD, alpha: 0.9 });
  }

  hide(): void { this.g.visible = false; this.base.visible = false; }
  destroy(): void { this.g.destroy({ children: true }); }
}
