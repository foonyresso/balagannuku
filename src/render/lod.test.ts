import { describe, expect, it } from 'vitest';
import { LOD_CONFIG, Lod, lodFlags, type LodKey } from './lod';

const order: LodKey[] = ['sway', 'particles', 'npcFrames', 'lights', 'npcSprite'];

describe('LOD від зуму', () => {
  it('упритул усе ввімкнено, на максимальному віддаленні вимкнено', () => {
    expect(Object.values(lodFlags(10)).every(Boolean)).toBe(true);
    expect(Object.values(lodFlags(0.08)).some(Boolean)).toBe(false);
  });
  it('чим далі, тим менше ввімкненого (монотонність)', () => {
    let prev = Infinity;
    for (let z = 10; z >= 0.08; z -= 0.02) {
      const n = Object.values(lodFlags(z)).filter(Boolean).length;
      expect(n).toBeLessThanOrEqual(prev); prev = n;
    }
  });
  it('порядок вимкнення: дрібні анімації → частинки → кадри жителів → точки', () => {
    const t = order.map((k) => LOD_CONFIG[k]);
    expect([...t].sort((a, b) => b - a)).toEqual(t);
    expect(LOD_CONFIG.sway).toBeGreaterThanOrEqual(LOD_CONFIG.particles);
    expect(LOD_CONFIG.particles).toBeGreaterThan(LOD_CONFIG.npcFrames);
    expect(LOD_CONFIG.npcFrames).toBeGreaterThan(LOD_CONFIG.npcSprite);
  });
  it('анімації дерев і трави вимкнені на середньому віддаленні, жителі — точки на дальньому', () => {
    const mid = lodFlags(0.5);
    expect(mid.sway).toBe(false); expect(mid.grass).toBe(false); expect(mid.npcFrames).toBe(true);
    const far = lodFlags(0.15);
    expect(far.npcSprite).toBe(false); expect(far.propsDetail).toBe(false);
  });
  it('гістерезис: біля порога прапор не мерехтить', () => {
    const l = new Lod(1), th = LOD_CONFIG.sway;
    l.update(th * 0.99); expect(l.flags.sway).toBe(false);
    l.update(th * 1.02); expect(l.flags.sway).toBe(false); // ще в смузі
    l.update(th * 1.1); expect(l.flags.sway).toBe(true);
    l.update(th * 1.02); expect(l.flags.sway).toBe(true);
    l.update(th * 0.99); expect(l.flags.sway).toBe(false);
  });
});
