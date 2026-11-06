import { describe, expect, it } from 'vitest';
import type { PlayerState } from '../shared';
import { RESOURCE_KINDS } from '../shared';
import { claimStart, canClaimStart, createInitialState, generateSectors } from './worldgen';
import { hexDisc, hexDistance, hexToPixel, pixelToHex } from './hex';

const mkPlayer = (id: string): PlayerState => ({
  id, nickname: id, token: id, color: 0, homeSector: null, ownedSectors: [],
  resources: Object.fromEntries(RESOURCE_KINDS.map((k) => [k, 0])) as PlayerState['resources'],
});

describe('hex', () => {
  it('кількість гексів у диску', () => expect(hexDisc(3)).toHaveLength(37));
  it('pixel <-> hex', () => {
    for (const h of hexDisc(5)) {
      const p = hexToPixel(h, 40);
      expect(pixelToHex(p.x + 3, p.y - 2, 40)).toEqual(h);
    }
  });
});

describe('worldgen', () => {
  it('детермінована за seed', () => {
    expect(generateSectors(42, 6)).toEqual(generateSectors(42, 6));
    expect(generateSectors(42, 6)).not.toEqual(generateSectors(43, 6));
  });
  it('richness у 0..1 і має різноманіття', () => {
    const s = generateSectors(7, 10);
    const vals = s.map((x) => x.richness.wood!);
    expect(Math.min(...vals)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...vals)).toBeLessThanOrEqual(1);
    expect(Math.max(...vals) - Math.min(...vals)).toBeGreaterThan(0.3);
  });
});

describe('вибір старту', () => {
  it('поважає мінімальну відстань', () => {
    const st = createInitialState(1, 8, 5, [mkPlayer('a'), mkPlayer('b')]);
    const a = st.sectors.find((s) => s.hex.q === 0 && s.hex.r === 0)!;
    expect(claimStart(st, 'a', a.id).ok).toBe(true);
    const near = st.sectors.find((s) => hexDistance(s.hex, a.hex) === 4)!;
    const far = st.sectors.find((s) => hexDistance(s.hex, a.hex) === 5)!;
    expect(canClaimStart(st, 'b', near.id)).toEqual({ ok: false, reason: 'too_close_to_start' });
    expect(canClaimStart(st, 'b', a.id)).toEqual({ ok: false, reason: 'occupied' });
    expect(canClaimStart(st, 'b', far.id).ok).toBe(true);
  });
});
