import { describe, expect, it } from 'vitest';
import { hexDisc } from '../sim/hex';
import { clampCamToWorld, depthOrder, hexToIso, pickTile, tileGeometry, isoToScreen, planeToIso, screenToHex, screenToPlane, zoomAt, ZOOM_MAX, ISO_Y, ISO_Z, VIEW_ANGLE_DEG, type Camera } from './projection';

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

describe('пікінг у порядку малювання', () => {
  const tiles = [
    { id: 0, hex: { q: 0, r: 0 }, height: 20 },
    { id: 1, hex: { q: 0, r: 1 }, height: 4 }, // ближче до глядача
  ];
  const c: Camera = { x: 0, y: 0, zoom: 1 };
  it('влучання в верхню грань високого заднього сектора', () => {
    const g = tileGeometry({ q: 0, r: 0 }, 20);
    const cx = (g.top[0] + g.top[6]) / 2, cy = (g.top[1] + g.top[7]) / 2 - 8;
    expect(pickTile(tiles, cx, cy, c)).toBe(0);
  });
  it('передній сектор перекриває стінку заднього: обирається передній', () => {
    // точка нижче верхньої грані заднього, але на верхній грані переднього
    const gf = tileGeometry({ q: 0, r: 1 }, 4);
    const x = (gf.top[0] + gf.top[6]) / 2, y = (gf.top[1] + gf.top[7]) / 2;
    expect(pickTile(tiles, x, y, c)).toBe(1);
  });
  it('поза картою — null', () => {
    expect(pickTile(tiles, 5000, 5000, c)).toBeNull();
  });
  it('стінка високого сектора належить йому', () => {
    const w = tileGeometry({ q: 0, r: 0 }, 20).walls[0].poly;
    const x = (w[0] + w[2] + w[4] + w[6]) / 4, y = (w[1] + w[3] + w[5] + w[7]) / 4;
    expect(pickTile([tiles[0]], x, y, c)).toBe(0);
  });
});

describe('межі камери', () => {
  const b = { minX: -100, minY: -100, maxX: 500, maxY: 500 };
  it('усередині меж камера не змінюється', () => {
    const c: Camera = { x: 300, y: 200, zoom: 1 };
    const mid = screenToPlane(400, 300, c);
    expect(mid.x).toBeGreaterThan(b.minX);
    expect(clampCamToWorld({ x: 400 - planeToIso(100, 100).x, y: 300 - planeToIso(100, 100).y, zoom: 1 }, 800, 600, b))
      .toEqual({ x: 400 - planeToIso(100, 100).x, y: 300 - planeToIso(100, 100).y, zoom: 1 });
  });
  it('далеко за межами центр повертається на край світу', () => {
    const c = clampCamToWorld({ x: -99999, y: 99999, zoom: 0.5 }, 800, 600, b);
    const mid = screenToPlane(400, 300, c);
    expect(mid.x).toBeGreaterThanOrEqual(b.minX - 1e-6);
    expect(mid.x).toBeLessThanOrEqual(b.maxX + 1e-6);
    expect(mid.y).toBeGreaterThanOrEqual(b.minY - 1e-6);
    expect(mid.y).toBeLessThanOrEqual(b.maxY + 1e-6);
    expect(c.zoom).toBe(0.5);
  });
});
