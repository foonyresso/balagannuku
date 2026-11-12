import { EMOTES_BY_CTX, HUNGRY_LINES, LINES, TALK, type Emote, type TalkCtx } from './talkData';

/** Лише рішення «хто, що й коли каже». Малювання — `bubbles.ts`. Випадковість лише для вигляду (симуляції не стосується). */

export interface TalkCandidate { id: number; cls: string; ctx: TalkCtx; hungry: boolean }
export type TalkEvent =
  | { id: number; kind: 'text'; text: string; life: number }
  | { id: number; kind: 'emote'; emote: Emote; life: number };
export type Rng = () => number;

/** Скільки висить текст: довший — довше, у межах мінімуму й максимуму. */
export const textLife = (text: string): number => Math.min(TALK.textMaxLife, Math.max(TALK.textMin, TALK.textBase + text.length * TALK.textPerChar));
const between = (r: Rng, [a, b]: readonly [number, number]): number => a + r() * (b - a);
const pick = <T>(r: Rng, a: readonly T[]): T => a[Math.min(a.length - 1, Math.floor(r() * a.length))];

/** Репліка для жителя: голодний інколи скаржиться на голод, решта — з рядків його класу. */
export function pickLine(c: TalkCandidate, r: Rng): string {
  if (c.hungry && r() < 0.5) return pick(r, HUNGRY_LINES);
  return pick(r, LINES[c.cls] ?? LINES.civ);
}
export function pickEmote(c: TalkCandidate, r: Rng): Emote {
  return pick(r, EMOTES_BY_CTX[c.hungry && r() < 0.6 ? 'hungry' : c.ctx]);
}

/** Розклад: два незалежні лічильники (тексти й емоції), ліміт одночасних, власна пауза кожного жителя. */
export class TalkDirector {
  private t = 0;
  private textAt: number;
  private emoteAt: number;
  /** До якого моменту житель зайнятий бульбашкою. */
  private busy = new Map<number, number>();
  private textFree = new Map<number, number>();
  private emoteFree = new Map<number, number>();
  private texts: number[] = [];
  private emotes: number[] = [];

  constructor(private rng: Rng = Math.random) {
    this.textAt = between(rng, TALK.textGap) / 2;
    this.emoteAt = between(rng, TALK.emoteGap);
  }

  /** Крок часу; `cands` — жителі, яких зараз видно. Повертає нові бульбашки. */
  step(dt: number, cands: readonly TalkCandidate[]): TalkEvent[] {
    this.t += dt;
    const out: TalkEvent[] = [];
    this.texts = this.texts.filter((u) => u > this.t);
    this.emotes = this.emotes.filter((u) => u > this.t);
    if (this.t >= this.textAt && this.texts.length < TALK.textMax) {
      const c = this.choose(cands, this.textFree);
      if (c) {
        const text = pickLine(c, this.rng), life = textLife(text);
        out.push({ id: c.id, kind: 'text', text, life });
        this.busy.set(c.id, this.t + life); this.textFree.set(c.id, this.t + TALK.textCooldown);
        this.texts.push(this.t + life);
        this.textAt = this.t + between(this.rng, TALK.textGap);
      } else this.textAt = this.t + 1;
    }
    if (this.t >= this.emoteAt && this.emotes.length < TALK.emoteMax) {
      const c = this.choose(cands, this.emoteFree);
      if (c) {
        const life = between(this.rng, TALK.emoteLife);
        out.push({ id: c.id, kind: 'emote', emote: pickEmote(c, this.rng), life });
        this.busy.set(c.id, this.t + life); this.emoteFree.set(c.id, this.t + TALK.emoteCooldown);
        this.emotes.push(this.t + life);
        this.emoteAt = this.t + between(this.rng, TALK.emoteGap);
      } else this.emoteAt = this.t + 0.5;
    }
    return out;
  }

  private choose(cands: readonly TalkCandidate[], free: Map<number, number>): TalkCandidate | null {
    const ok = cands.filter((c) => (this.busy.get(c.id) ?? 0) <= this.t && (free.get(c.id) ?? 0) <= this.t);
    return ok.length ? pick(this.rng, ok) : null;
  }
}
