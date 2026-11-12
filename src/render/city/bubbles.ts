import { Container, Graphics, Text } from 'pixi.js';
import { PROFESSIONS, TASKS } from '../../shared';
import { HUNGRY_BELOW } from '../../sim/balance';
import { classOf } from '../style';
import { EMOTE_R, emoteIcon } from './emoteIcons';
import type { NpcLayer } from './npcs';
import type { Scene } from './scene';
import { TalkDirector, type TalkCandidate, type TalkEvent } from './talk';
import { TALK, type TalkCtx } from './talkData';

/** Бульбашки над головами жителів: тексти й емоції. Шар лежить у екранних координатах поза камерою, тож розмір сталий при зумі. */

const FADE_IN = 0.15, FADE_OUT = 0.3, TAIL = 6, GAP = 4;
const WORK = TASKS.indexOf('work'), WALK = TASKS.indexOf('walk'), CARRY = TASKS.indexOf('carry');

interface Bubble { id: number; node: Container; age: number; life: number }

/** Масштаб інтерфейсу з CSS (`--ui`): бульбашки читаються так само, як панелі. */
function uiScale(): number {
  try { return Math.min(2.5, Math.max(0.6, parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui')) || 1)); } catch { return 1; }
}

export class BubbleLayer {
  readonly layer = new Container();
  private dir = new TalkDirector();
  private list: Bubble[] = [];

  get count(): number { return this.list.length; }
  /** Для автотестів: що зараз висить. */
  get kinds(): { texts: number; emotes: number } {
    return { texts: this.list.filter((b) => b.node.label === 'text').length, emotes: this.list.filter((b) => b.node.label === 'emote').length };
  }

  update(scene: Scene, npcs: NpcLayer, dt: number): void {
    const { cam, app } = scene, z = cam.zoom, n = scene.w.state.npcs;
    const on = z >= TALK.minZoom;
    this.layer.visible = on;
    const heads = new Map<number, { x: number; y: number }>(), cands: TalkCandidate[] = [];
    const W = app.screen.width, H = app.screen.height;
    npcs.forEachHead((i, hx, hy) => {
      const x = hx * z + cam.x, y = hy * z + cam.y;
      heads.set(i, { x, y });
      if (!on || x < 30 || y < 60 || x > W - 30 || y > H - 10) return;
      const t = n.task[i], ctx: TalkCtx = t === WORK ? 'work' : t === WALK || t === CARRY ? 'walk' : 'idle';
      cands.push({ id: i, cls: classOf(PROFESSIONS[n.profession[i]] ?? 'idle'), ctx, hungry: n.fullness[i] < HUNGRY_BELOW });
    });
    // Час іде й без видимих: нові бульбашки лише для тих, кого видно.
    for (const e of this.dir.step(dt, cands)) this.spawn(e);
    const keep: Bubble[] = [];
    for (const b of this.list) {
      b.age += dt;
      const h = heads.get(b.id);
      if (!h || b.age >= b.life) { b.node.destroy({ children: true }); continue; }
      const a = Math.min(1, b.age / FADE_IN, (b.life - b.age) / FADE_OUT), s = uiScale();
      b.node.alpha = Math.max(0, a);
      b.node.scale.set(s * (0.7 + 0.3 * Math.min(1, b.age / FADE_IN)));
      b.node.position.set(Math.round(h.x), Math.round(h.y - GAP));
      keep.push(b);
    }
    this.list = keep;
  }

  private spawn(e: TalkEvent): void {
    const node = new Container();
    node.label = e.kind;
    const bg = new Graphics();
    if (e.kind === 'text') {
      const t = new Text({ text: e.text, style: { fontFamily: 'sans-serif', fontSize: 13, fill: 0x3a2a18, wordWrap: true, wordWrapWidth: 150, align: 'center', lineHeight: 16 } });
      t.anchor.set(0.5, 1);
      const w = Math.ceil(t.width) + 18, h = Math.ceil(t.height) + 12;
      t.position.set(0, -TAIL - 6);
      bg.roundRect(-w / 2, -TAIL - h, w, h, 8).fill(0xf6ecd0).stroke({ width: 2, color: 0x4a3520 });
      bg.poly([-5, -TAIL - 1, 5, -TAIL - 1, 0, 0]).fill(0xf6ecd0);
      bg.moveTo(-5, -TAIL).lineTo(0, 0).lineTo(5, -TAIL).stroke({ width: 2, color: 0x4a3520, join: 'round' });
      node.addChild(bg, t);
    } else {
      const r = EMOTE_R, icon = emoteIcon(e.emote);
      icon.position.set(0, -TAIL - r);
      bg.circle(0, -TAIL - r, r).fill(0xf6ecd0).stroke({ width: 2, color: 0x4a3520 });
      bg.poly([-4, -TAIL - 1, 4, -TAIL - 1, 0, 0]).fill(0xf6ecd0);
      bg.moveTo(-4, -TAIL).lineTo(0, 0).lineTo(4, -TAIL).stroke({ width: 2, color: 0x4a3520, join: 'round' });
      node.addChild(bg, icon);
    }
    node.alpha = 0;
    this.layer.addChild(node);
    this.list.push({ id: e.id, node, age: 0, life: e.life });
  }

  destroy(): void { this.layer.destroy({ children: true }); this.list = []; }
}
