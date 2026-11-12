import { clampCamInside, planeToIso, zoomAt } from '../projection';
import { CITY_ZOOM_MAX, TILE, type Scene, type Ui } from './scene';
import { Surroundings } from './surroundings';

/** Камера міста: фіксована ізометрія, лише пан і зум (формули — ../projection.ts). */

/** Застосувати камеру сцени: обмежити світом, зсунути й масштабувати корінь. */
export function applyCam(scene: Scene): void {
  scene.cam = clampCamInside(scene.cam, scene.app.screen.width, scene.app.screen.height, Surroundings.bounds());
  scene.root.position.set(scene.cam.x, scene.cam.y);
  scene.root.scale.set(scene.cam.zoom);
  scene.atmo.setCam(scene.cam);
}

/** Пан на (dx, dy) екранних пікселів. */
export function panBy(scene: Scene, dx: number, dy: number): void {
  scene.cam.x += dx; scene.cam.y += dy;
  applyCam(scene);
}

/** Колесо миші: зум до курсора; під час стеження — до центру екрана, де лежить об'єкт. */
export function wheelZoom(scene: Scene, ui: Ui, e: WheelEvent): void {
  const f = Math.exp(-e.deltaY * 0.0015);
  if (ui.following) scene.cam.zoom = ui.targetZoom = Math.min(CITY_ZOOM_MAX, Math.max(0.08, scene.cam.zoom * f));
  else scene.cam = zoomAt(scene.cam, e.clientX, e.clientY, f, 0.08, CITY_ZOOM_MAX);
  applyCam(scene);
}

/** Камера слідує за точкою `pos` (тайли), м'яко: об'єкт у центрі екрана, зум плавно наближається до targetZoom. */
export function followPos(scene: Scene, ui: Ui, pos: { x: number; y: number }): void {
  const z = scene.cam.zoom + (ui.targetZoom - scene.cam.zoom) * 0.2;
  const iso = planeToIso(pos.x * TILE, pos.y * TILE, 4);
  scene.cam = { zoom: z, x: scene.app.screen.width / 2 - iso.x * z, y: scene.app.screen.height / 2 - iso.y * z };
  applyCam(scene);
}
