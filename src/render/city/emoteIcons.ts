import { Container, Graphics, Text } from 'pixi.js';
import type { Emote } from './talkData';

/** Іконки емоцій: малюються кодом (власні, без ліцензій), по центру (0,0) у колі радіусом `EMOTE_R`. */
export const EMOTE_R = 13;

const glyph = (ch: string, fill: number): Text => {
  const t = new Text({ text: ch, style: { fontFamily: 'sans-serif', fontWeight: '900', fontSize: 20, fill, stroke: { color: 0xffffff, width: 2 } } });
  t.anchor.set(0.5);
  return t;
};

/** Іконка емоції. */
export function emoteIcon(e: Emote): Container {
  const c = new Container(), g = new Graphics();
  c.addChild(g);
  switch (e) {
    case 'heart':
      g.circle(-3.6, -2.5, 4.2).circle(3.6, -2.5, 4.2).poly([-7.6, -0.5, 7.6, -0.5, 0, 8]).fill(0xe0434f);
      g.circle(-4.5, -3.5, 1.3).fill({ color: 0xffffff, alpha: 0.7 });
      break;
    case 'note':
      g.ellipse(-2.5, 5, 3.6, 2.8).fill(0x2f3a8c).rect(0.2, -8, 1.8, 13.5).fill(0x2f3a8c).poly([2, -8, 7, -4, 7, -1, 2, -4.5]).fill(0x2f3a8c);
      break;
    case 'zzz':
      for (const [x, y, s] of [[-6, 1, 4], [-1, -3.5, 5], [4, -8, 6]] as const)
        g.moveTo(x - s / 2, y - s / 2).lineTo(x + s / 2, y - s / 2).lineTo(x - s / 2, y + s / 2).lineTo(x + s / 2, y + s / 2).stroke({ width: 1.8, color: 0x4a62b8, join: 'round' });
      break;
    case 'question': c.addChild(glyph('?', 0x2f6fb5)); break;
    case 'exclaim': c.addChild(glyph('!', 0xd9342b)); break;
    case 'sweat':
      g.poly([0, -9, 5.5, 1.5, -5.5, 1.5]).circle(0, 3, 5.5).fill(0x5fb4e8);
      g.circle(-2, 3, 1.5).fill({ color: 0xffffff, alpha: 0.8 });
      break;
    case 'spark':
      g.poly([0, -10, 2.6, -2.6, 10, 0, 2.6, 2.6, 0, 10, -2.6, 2.6, -10, 0, -2.6, -2.6]).fill(0xf5c518).stroke({ width: 1.2, color: 0xb8860b });
      break;
    case 'food':
      g.circle(0, 2, 7).fill(0xd8402e).stroke({ width: 1.2, color: 0x8a2118 });
      g.rect(-0.8, -7, 1.6, 4).fill(0x5a3a1a);
      g.ellipse(4, -5, 4, 2.2).fill(0x5aa02c);
      break;
  }
  return c;
}
