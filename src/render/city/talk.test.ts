import { describe, expect, it } from 'vitest';
import { CLASSES } from '../style/characters';
import { TalkDirector, pickEmote, pickLine, textLife, type TalkCandidate, type TalkEvent } from './talk';
import { EMOTES, EMOTES_BY_CTX, HUNGRY_LINES, LINES, TALK } from './talkData';

const seeded = (s = 7) => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
const cand = (id: number, over: Partial<TalkCandidate> = {}): TalkCandidate => ({ id, cls: 'civ', ctx: 'idle', hungry: false, ...over });

describe('дані реплік', () => {
  it('кожен клас вигляду має 2+ реплік, є запасні civ', () => {
    for (const c of Object.keys(CLASSES)) expect(LINES[c]?.length, c).toBeGreaterThanOrEqual(2);
    expect(LINES.civ.length).toBeGreaterThan(0);
    expect(HUNGRY_LINES.length).toBeGreaterThan(0);
  });
  it('набори емоцій містять лише відомі іконки', () => {
    for (const set of Object.values(EMOTES_BY_CTX)) for (const e of set) expect(EMOTES).toContain(e);
  });
  it('клас без реплік говорить як civ', () => {
    expect(LINES.civ).toContain(pickLine(cand(1, { cls: 'невідомий' }), seeded()));
  });
  it('емоція береться з набору контексту', () => {
    expect(EMOTES_BY_CTX.work).toContain(pickEmote(cand(1, { ctx: 'work' }), seeded()));
  });
});

describe('textLife', () => {
  it('4–7 с і росте з довжиною', () => {
    expect(textLife('Так')).toBe(TALK.textMin);
    expect(textLife('я'.repeat(200))).toBe(TALK.textMaxLife);
    expect(textLife('я'.repeat(30))).toBeGreaterThan(textLife('я'.repeat(15)));
    for (const l of Object.values(LINES).flat()) { const t = textLife(l); expect(t).toBeGreaterThanOrEqual(4); expect(t).toBeLessThanOrEqual(7); }
  });
});

describe('TalkDirector', () => {
  const run = (secs: number, cands: TalkCandidate[], seed = 3): TalkEvent[] => {
    const d = new TalkDirector(seeded(seed)), out: TalkEvent[] = [];
    for (let t = 0; t < secs; t += 0.1) out.push(...d.step(0.1, cands));
    return out;
  };
  it('без видимих нічого не каже', () => expect(run(120, [])).toHaveLength(0));
  it('тексти рідкісні, емоції частіші, лічильники окремі', () => {
    const ev = run(300, Array.from({ length: 12 }, (_, i) => cand(i)));
    const texts = ev.filter((e) => e.kind === 'text'), emotes = ev.filter((e) => e.kind === 'emote');
    expect(texts.length).toBeGreaterThan(5);
    expect(texts.length).toBeLessThan(300 / TALK.textGap[0] + 1);
    expect(emotes.length).toBeGreaterThan(texts.length);
  });
  it('один житель не говорить частіше за власну паузу', () => {
    const ev = run(300, [cand(1)]);
    const times = ev.filter((e) => e.kind === 'text').length, emo = ev.filter((e) => e.kind === 'emote').length;
    expect(times).toBeLessThanOrEqual(Math.ceil(300 / TALK.textCooldown));
    expect(emo).toBeLessThanOrEqual(Math.ceil(300 / TALK.emoteCooldown));
  });
  it('тривалість у межах', () => {
    for (const e of run(200, [cand(1), cand(2), cand(3)])) {
      if (e.kind === 'text') { expect(e.life).toBeGreaterThanOrEqual(4); expect(e.life).toBeLessThanOrEqual(7); }
      else { expect(e.life).toBeGreaterThanOrEqual(TALK.emoteLife[0]); expect(e.life).toBeLessThanOrEqual(TALK.emoteLife[1]); }
    }
  });
  it('одночасних не більше ліміту', () => {
    const d = new TalkDirector(seeded(9)), live: { until: number; k: string }[] = [];
    let t = 0, maxT = 0, maxE = 0;
    const cs = Array.from({ length: 40 }, (_, i) => cand(i));
    for (let k = 0; k < 4000; k++) {
      t += 0.1;
      for (const e of d.step(0.1, cs)) live.push({ until: t + e.life, k: e.kind });
      const alive = live.filter((l) => l.until > t);
      maxT = Math.max(maxT, alive.filter((l) => l.k === 'text').length); maxE = Math.max(maxE, alive.filter((l) => l.k === 'emote').length);
    }
    expect(maxT).toBeLessThanOrEqual(TALK.textMax); expect(maxE).toBeLessThanOrEqual(TALK.emoteMax);
  });
  it('житель не має двох бульбашок разом', () => {
    const d = new TalkDirector(seeded(5)), until = new Map<number, number>();
    let t = 0;
    for (let k = 0; k < 6000; k++) {
      t += 0.1;
      for (const e of d.step(0.1, [cand(1), cand(2)])) {
        expect((until.get(e.id) ?? 0) <= t + 1e-9).toBe(true);
        until.set(e.id, t + e.life);
      }
    }
  });
});
