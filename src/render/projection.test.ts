import { describe, expect, it } from 'vitest';
import { hexDisc } from '../sim/hex';
import { depthOrder, hexToIso, isoToScreen, planeToIso, screenToHex, screenToPlane, zoomAt, ZOOM_MAX, ISO_Y, ISO_Z, VIEW_ANGLE_DEG, type Camera } from './projection';

const cam: Camera = { x: 400, y: 300, zoom: 1.3 };

describe('ізо-проєкція', () => {
  it('plane -> screen -> plane (кругова)', () => {
    const iso = planeToIso(123, -45);
    const s = isoToScreen(iso, cam);
    const p = screenToPlane(s.x, s.y, cam);
    expect(p.x).toBeCloseTo(123, 6);
    expect(p.y).toBeCloseTo(-45, 6);
  });
  it('центр кожного гекса пікається в сам гекс', () => {
    for (const h of hexDisc(6)) {
      const s = isoToScreen(hexToIso(h), cam);
      expect(screenToHex(s.x + 2, s.y - 1, cam)).toEqual(h);
    }
  });
  it('висота зсуває точку вгору екрана', () => {
    expect(planeToIso(10, 10, 8).y).toBeCloseTo(planeToIso(10, 10, 0).y - 8 * ISO_Z, 9);
  });
  it('кут огляду 40–45° (не строго зверху)', () => {
    expect(VIEW_ANGLE_DEG).toBeGreaterThanOrEqual(40);
    expect(VIEW_ANGLE_DEG).toBeLessThanOrEqual(45);
    expect(ISO_Y).toBeLessThan(0.75);
    expect(ISO_Y * ISO_Y + ISO_Z * ISO_Z).toBeCloseTo(1, 9);
  });
  it('зум тримає точку під курсором і обмежений', () => {
    const before = screenToPlane(500, 350, cam);
    const c2 = zoomAt(cam, 500, 350, 1.5);
    const after = screenToPlane(500, 350, c2);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(zoomAt(cam, 0, 0, 1000).zoom).toBe(ZOOM_MAX);
  });
  it('depthOrder: нижчий рядок — ближче', () => {
    expect(depthOrder({ q: 0, r: 0 }, { q: 0, r: 1 })).toBeLessThan(0);
  });
});
