import type { BuildingKind } from '../../shared';
import { applyCommand, idleNpcs, slotsOf, staffBuilding } from '../../sim';
import { FOOTPRINT, JOB_OF, MAX_WORKERS } from '../../sim/balance';
import type { HudHooks } from '../../ui/cityHud';
import type { CityApi, Tile } from './scene';

/** Дії гравця в місті: будівництво, працівники, пауза, знесення. Стан гри змінюється лише командами. */

export type Cmd = Parameters<typeof applyCommand>[1]['cmd'];
export const send = (v: CityApi, cmd: Cmd) => applyCommand(v.scene.w, { player: v.scene.player, seq: 0, cmd });

/** Лівий верхній тайл footprint споруди `kind`, центрованого під тайлом `t`. */
export function anchor(kind: BuildingKind | null, t: Tile): Tile {
  const fp = kind ? FOOTPRINT[kind] : undefined;
  return fp ? { x: t.x - (fp.w >> 1), y: t.y - (fp.h >> 1) } : t;
}

/** Клік у режимі будівництва: поставити вибрану споруду під курсором і посадити працівників. */
export function placeBuilding(v: CityApi, t: Tile): void {
  const { w, player, sector } = v.scene, kind = v.ui.build;
  if (!kind) return;
  const r = send(v, { type: 'place_building', kind, sector, cell: anchor(kind, t) });
  if (!r.ok) { v.hud.say(r.reason === 'no_resources' ? `Не вистачає: ${v.hud.missingText(kind)}` : 'Тут не можна (зайнято, ліс/камінь поруч або край сектора)'); return; }
  const b = w.state.buildings[w.state.buildings.length - 1];
  const n = staffBuilding(w, player, b.id);
  v.hud.say(n ? `Побудовано, працівників: ${n}` : MAX_WORKERS[b.kind] ? 'Побудовано, немає вільних працівників' : 'Побудовано');
  v.ui.build = null; // одна споруда за вибір: далі курсор порожній
  v.ui.hover = null;
  v.rebuild();
  v.refreshHud();
}

/** «+»: посадити найближчого вільного жителя; немає вільних — вмикаємо вибір зі списку робітників (можна перетягнути із чужої роботи). */
function addWorker(v: CityApi, id: number): void {
  const { w, player } = v.scene, b = w.byId.get(id);
  if (!b) return;
  const max = MAX_WORKERS[b.kind] ?? 0;
  if (slotsOf(b) >= max) { v.hud.say('Це максимум працівників для цієї споруди'); return; }
  send(v, { type: 'set_worker_count', building: id, count: slotsOf(b) + 1 }); // вільне місце займає автопризначення
  if (b.workers.length < slotsOf(b) && !idleNpcs(w, player).length) {
    v.hud.say('Вільних жителів немає: обери робітника зі списку, щоб перевести його сюди');
    v.hud.openTab('people'); v.hud.assignTarget = id;
  }
  v.refreshHud();
}

function assignTo(v: CityApi, npc: number, id: number): void {
  const b = v.scene.w.byId.get(id), job = b && JOB_OF[b.kind];
  if (!b || !job) return;
  const r = send(v, { type: 'assign_worker', npc, profession: job, building: id });
  v.hud.say(r.ok ? 'Призначено' : r.reason === 'occupied' ? 'У споруді немає вільних місць' : 'Не можна призначити');
  v.refreshHud();
}

/** Кнопки панелі міста -> дії. */
export function hudHooks(v: CityApi): HudHooks {
  const byId = (id: number) => v.scene.w.byId.get(id);
  return {
    pickBuild: (k) => v.setBuild(k),
    select: (sel, follow) => v.select(sel, follow),
    deselect: () => v.deselect(),
    follow: (on) => v.setFollow(on),
    back: () => v.exit(),
    speed: (s) => v.userSpeed(s),
    addWorker: (id) => addWorker(v, id),
    removeWorker: (id) => {
      const b = byId(id);
      if (b) send(v, { type: 'set_worker_count', building: id, count: Math.max(0, slotsOf(b) - 1) });
      v.refreshHud();
    },
    assign: (npc, id) => assignTo(v, npc, id),
    unassign: (npc) => { send(v, { type: 'unassign_worker', npc }); v.refreshHud(); },
    pause: (id) => { const b = byId(id); if (b) send(v, { type: 'set_building_paused', building: id, paused: !b.paused }); v.refreshHud(); },
    demolish: (id) => {
      const r = send(v, { type: 'demolish_building', building: id });
      if (r.ok) { v.deselect(); v.rebuild(true); v.hud.say('Споруду знесено'); }
    },
  };
}
