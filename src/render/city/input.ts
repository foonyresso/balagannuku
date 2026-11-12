import type { Sel } from '../../ui/info';
import { SPEEDS } from '../../ui/pacer';
import { nextTime } from '../style';
import { placeBuilding } from './actions';
import { panBy, wheelZoom } from './camera';
import { boxItems, pickSel, pickTile } from './picking';
import type { CityApi } from './scene';

/**
 * Ввід міста: миша й клавіатура. ЛКМ — вибір або будівництво, перетягування ЛКМ у режимі «вибір» — рамка,
 * ПКМ/СКМ — пан (клік ПКМ скасовує), колесо — зум, Esc / Пробіл / 1-5 / N — клавіші.
 */
export class CityInput {
  private drag: { x: number; y: number; sx: number; sy: number; moved: boolean; button: number; box: boolean; shift: boolean; pick: Sel | null } | null = null;
  private boxEl = document.createElement('div');

  constructor(private v: CityApi) {
    this.boxEl.id = 'selBox'; this.boxEl.hidden = true; document.body.appendChild(this.boxEl);
    const el = v.scene.app.canvas;
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('wheel', this.wheel, { passive: false });
    el.addEventListener('contextmenu', this.noMenu);
    window.addEventListener('keydown', this.key);
  }

  destroy(): void {
    const el = this.v.scene.app.canvas;
    el.removeEventListener('pointermove', this.move);
    el.removeEventListener('pointerdown', this.down);
    el.removeEventListener('pointerup', this.up);
    el.removeEventListener('wheel', this.wheel);
    el.removeEventListener('contextmenu', this.noMenu);
    window.removeEventListener('keydown', this.key);
    el.style.cursor = '';
    this.boxEl.remove();
  }

  private noMenu = (e: Event): void => e.preventDefault();

  /** Esc: скасувати будівництво, інакше зняти виділення. */
  private key = (e: KeyboardEvent): void => {
    const v = this.v, { ui } = v, { atmo } = v.scene;
    if (e.code === 'KeyN') { atmo.setTime(nextTime(atmo.key)); v.hud.say(`Пора доби: ${({ dusk: 'сутінки', night: 'ніч', dawn: 'світанок' } as const)[atmo.key]}`); return; }
    if (e.code === 'Space') { e.preventDefault(); v.userSpeed(ui.speed ? 0 : ui.resumeSpeed); return; }
    const d = /^Digit([1-5])$/.exec(e.code); // 1..5 -> 1×, 2×, 5×, 10×, 100×
    if (d) { v.userSpeed(SPEEDS[Number(d[1])]); return; }
    if (e.key !== 'Escape') return;
    if (ui.build) v.setBuild(null); else if (ui.sel) v.deselect();
  };

  private move = (e: PointerEvent): void => {
    const v = this.v, { ui, scene } = v, d = this.drag;
    if (d) {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (d.box) { // рамка виділення (LMB у режимі «вибір»)
        if (d.moved || Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 4) { d.moved = true; this.showBox(d.sx, d.sy, e.clientX, e.clientY); }
      } else if (d.moved || Math.abs(dx) + Math.abs(dy) > 4) { // пан: ПКМ/СКМ (або ЛКМ у режимі будівництва)
        if (!d.moved && ui.following) { ui.following = false; v.refreshHud(); } // ручний пан знімає стеження
        d.moved = true;
        d.x = e.clientX; d.y = e.clientY; panBy(scene, dx, dy);
      }
    }
    if (ui.build) { ui.hover = pickTile(scene, e); ui.hoverSel = null; scene.app.canvas.style.cursor = 'crosshair'; }
    else {
      ui.hover = null;
      ui.hoverSel = this.drag?.moved ? null : pickSel(scene, e, ui.speed);
      scene.app.canvas.style.cursor = ui.hoverSel ? 'pointer' : 'default';
    }
  };

  private down = (e: PointerEvent): void => {
    const { ui, scene } = this.v;
    try { scene.app.canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const box = e.button === 0 && !ui.build;
    // Що було під курсором у момент натискання: житель встигає втекти до відпускання (особливо на 2×–100×)
    this.drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, button: e.button, box, shift: e.shiftKey, pick: box ? pickSel(scene, e, ui.speed) : null };
  };

  private showBox(x0: number, y0: number, x1: number, y1: number): void {
    const b = this.boxEl.style;
    this.boxEl.hidden = false;
    b.left = `${Math.min(x0, x1)}px`; b.top = `${Math.min(y0, y1)}px`; b.width = `${Math.abs(x1 - x0)}px`; b.height = `${Math.abs(y1 - y0)}px`;
  }

  /** Виділення рамкою за екранними позиціями; Shift додає до поточного виділення (того ж класу). */
  private boxSelect(x0: number, y0: number, x1: number, y1: number, additive: boolean): void {
    const v = this.v, { ui } = v;
    let items = boxItems(v.scene, x0, y0, x1, y1);
    if (additive && ui.sel && items.length) {
      const cur = ui.sel.t === 'group' ? ui.sel.items : [ui.sel];
      if (cur[0].t === items[0].t) {
        const seen = new Set(cur.map((i) => JSON.stringify(i)));
        items = [...cur, ...items.filter((i) => !seen.has(JSON.stringify(i)))];
      }
    }
    if (!items.length) { if (!additive) v.deselect(); return; }
    v.select(items.length === 1 ? items[0] : { t: 'group', items }, false);
  }

  private up = (e: PointerEvent): void => {
    const v = this.v, { ui, scene } = v;
    const d = this.drag; this.drag = null;
    this.boxEl.hidden = true;
    if (!d) return;
    if (d.box && d.moved) { this.boxSelect(d.sx, d.sy, e.clientX, e.clientY, e.shiftKey || d.shift); return; }
    if (d.moved) return;
    if (d.button === 2) { // ПКМ: скасувати будівництво або виділення
      if (ui.build) v.setBuild(null); else v.deselect();
      return;
    }
    if (d.button !== 0) return;
    if (!ui.build) { // режим «вибір»; житель, що був під курсором при натисканні, має пріоритет
      const s = d.pick?.t === 'npc' ? d.pick : pickSel(scene, e, ui.speed);
      if (s && (e.shiftKey || d.shift) && ui.sel && ui.sel.t === s.t) { // Shift+клік додає
        const cur = ui.sel.t === 'group' ? ui.sel.items : [ui.sel];
        const key = JSON.stringify(s);
        v.select({ t: 'group', items: cur.some((i) => JSON.stringify(i) === key) ? cur.filter((i) => JSON.stringify(i) !== key) : [...cur, s] }, false);
      } else if (s) v.select(s, false); else v.deselect();
      return;
    }
    const t = pickTile(scene, e);
    if (t) placeBuilding(v, t);
  };

  private wheel = (e: WheelEvent): void => {
    e.preventDefault();
    wheelZoom(this.v.scene, this.v.ui, e);
  };
}
