import type { BuildingKind } from '../shared';
import { buildCheck, residents, type SimWorld } from '../sim';
import { describeSel, RES_NAMES, BUILD_NAMES, type Sel } from './info';
import { SPEEDS } from './pacer';
import type { HudHooks, HudState } from './hudTypes';
import { SECTIONS } from './sections';
import { WindowManager } from './windows';
import './theme.css';
import './cityHud.css';

export type { HudHooks, HudState };

/** Верхня смуга ресурсів і швидкості, нижня панель розділів з вікнами та картка інформації про виділений об'єкт. */
export class CityHud {
  readonly root = document.createElement('div');
  private $ = (s: string) => this.root.querySelector<HTMLElement>(s)!;
  private wm: WindowManager;
  private infoSig = '';
  /** Режим призначення: клік по картці жителя сажає його в цю споруду. */
  private assign = { target: null as number | null };
  private lastNpc: number | null = null;
  private msgTimer: number | undefined;
  private st: HudState = { selected: null, build: null, following: false, speed: 1, actualSpeed: 1, speedLocked: false };
  private lastFollow = false;
  private lastSelBuilding: number | null = null;

  get assignTarget(): number | null { return this.assign.target; }
  set assignTarget(v: number | null) { this.assign.target = v; }

  constructor(hooks: HudHooks, private w: SimWorld, private player: string, private sector: number) {
    this.root.id = 'cityHud';
    this.root.innerHTML = `
      <div id="cityTop" class="k-frame"><span id="cityRes"></span><span id="citySpeed">${SPEEDS.map((v) => `<button class="k-btn" data-speed="${v}" title="${v ? v + '×' : 'Пауза (Пробіл)'}">${v ? v + '×' : '⏸'}</button>`).join('')}<small id="speedActual"></small></span><button id="cityBack" class="k-btn">← До карти</button></div>
      <div id="cityInfo" class="k-frame" hidden>
        <div class="hd"><div><h3 id="infoTitle" class="k-title"></h3><small id="infoKind"></small></div><button id="infoClose" class="k-btn" title="Закрити (Esc)">×</button></div>
        <table id="infoRows"></table>
        <div id="infoSlots" hidden><span>Працівники</span><button class="k-btn" data-slot="-">−</button><b id="slotNum"></b><button class="k-btn" data-slot="+">+</button></div>
        <div id="infoWorkers"></div>
        <div id="infoItems"></div>
        <div id="infoAssign"></div>
        <div class="acts"><button class="k-btn" id="infoFollow"></button><button class="k-btn" id="infoFree" hidden>Звільнити з роботи</button><button class="k-btn" data-pause hidden></button><button class="k-btn" id="infoDemolish" hidden>Знести</button></div>
      </div>
      <div id="cityNotes"><div id="cityHint"></div><div id="cityMsg"></div></div>`;
    document.body.appendChild(this.root);
    this.wm = new WindowManager(this.root, SECTIONS, { hooks, w, player, sector, assign: this.assign });
    // Esc: спершу закриває вікно в центрі; пласке вікно будівництва закривається, лише коли нічого скасовувати.
    window.addEventListener('keydown', this.onKey, true);
    const on = (sel: string, fn: (t: HTMLElement) => void, ev = 'click') => this.root.addEventListener(ev, (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>(sel);
      if (t && this.root.contains(t)) fn(t);
    });
    on('button[data-speed]', (b) => hooks.speed(Number(b.dataset.speed)));
    this.$('#cityBack').onclick = () => hooks.back();
    this.$('#infoClose').onclick = () => hooks.deselect();
    this.$('#infoFollow').onclick = () => hooks.follow(!this.lastFollow);
    this.$('#infoDemolish').onclick = () => {
      const b = this.$('#infoDemolish');
      if (!b.classList.contains('arm')) { b.classList.add('arm'); b.textContent = 'Точно знести?'; return; }
      b.classList.remove('arm'); b.textContent = 'Знести';
      const id = this.lastSelBuilding; if (id !== null) hooks.demolish(id);
    };
    on('button[data-pause]', () => { const id = this.lastSelBuilding; if (id !== null) hooks.pause(id); });
    // Рядки спрацьовують на pointerdown: вміст оновлюється, і click може не дійти.
    on('button[data-slot]', (b) => {
      const id = this.lastSelBuilding; if (id === null) return;
      if (b.dataset.slot === '+') hooks.addWorker(id); else hooks.removeWorker(id);
    });
    on('#infoAssign button', (b) => { const id = this.lastNpc; if (id !== null) hooks.assign(id, Number(b.dataset.b)); });
    this.$('#infoFree').onclick = () => { if (this.lastNpc !== null) hooks.unassign(this.lastNpc); };
    on('#infoItems .row', (r) => hooks.select(JSON.parse(r.dataset.sel!) as Sel, false), 'pointerdown');
    on('#infoWorkers .row', (r) => hooks.select({ t: 'npc', id: Number(r.dataset.key) }, false), 'pointerdown');
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    const place = this.wm.openPlace;
    if (place === 'center' || (place === 'dock' && !this.st.build && !this.st.selected)) { this.wm.close(); this.assign.target = null; e.stopImmediatePropagation(); }
  };

  /** Відкрити розділ за id (`build`, `economy`, `npcs`…). */
  openWindow(id: string, tab?: string): void { this.wm.open(id, tab); }

  /** Коротке повідомлення над нижньою панеллю (зникає саме). */
  say(text: string): void {
    const m = this.$('#cityMsg');
    m.textContent = text;
    window.clearTimeout(this.msgTimer);
    this.msgTimer = window.setTimeout(() => { m.textContent = ''; }, 6000);
  }

  missingText(k: BuildingKind): string {
    const m = buildCheck(this.w, this.player, k).missing;
    return Object.entries(m).map(([r, v]) => `${v} ${RES_NAMES[r]?.toLowerCase() ?? r}`).join(', ');
  }

  update(st: HudState): void {
    this.st = st;
    const w = this.w;
    this.lastFollow = st.following;
    this.updateSpeed(st);
    const p = w.state.players.find((x) => x.id === this.player)!;
    const list = residents(w, this.player);
    const idle = list.filter((r) => r.workplace < 0).length;
    this.$('#cityRes').innerHTML = Object.entries(RES_NAMES).map(([k, n]) => `<span class="res"><i class="k-pip ${k}"></i>${n} <b>${p.resources[k as 'wood']}</b></span>`).join('') +
      `<span class="res">Жителів <b>${list.length}</b>, вільних <b>${idle}</b></span>`;
    this.$('#cityHint').textContent = this.assign.target !== null ? 'Обери жителя в списку, щоб посадити його в споруду (Esc — скасувати)'
      : st.build ? `Будівництво: ${BUILD_NAMES[st.build]}. Клік по землі, Esc або ПКМ — скасувати` : '';
    this.wm.mark('build', !!st.build);
    this.wm.update(st);
    this.updateInfo(st);
  }

  /** Кнопки швидкості: активна підсвічена; якщо сим не встигає — показуємо фактичну швидкість. */
  updateSpeed(st: HudState): void {
    this.root.querySelectorAll<HTMLButtonElement>('button[data-speed]').forEach((b) => {
      b.classList.toggle('sel', Number(b.dataset.speed) === st.speed);
      b.disabled = st.speedLocked;
    });
    const slow = st.speed > 1 && st.actualSpeed < st.speed * 0.9;
    const t = st.speedLocked ? 'керує хост' : slow ? `фактично ≈${st.actualSpeed >= 10 ? Math.round(st.actualSpeed) : st.actualSpeed.toFixed(1)}×` : '';
    const el = this.$('#speedActual');
    if (el.textContent !== t) el.textContent = t;
  }

  private updateInfo(st: HudState): void {
    const box = this.$('#cityInfo');
    const info = st.selected ? describeSel(this.w, this.player, this.sector, st.selected) : null;
    box.hidden = !info;
    this.lastSelBuilding = info?.building ?? null;
    this.lastNpc = info?.npc ?? null;
    if (!info) { this.infoSig = ''; return; }
    const sig = JSON.stringify([info.title, info.kind, info.rows, info.workers, info.items, info.warn, info.assign, info.canUnassign, info.slots]);
    if (sig !== this.infoSig) {
      this.infoSig = sig;
      this.$('#infoTitle').textContent = info.title;
      this.$('#infoKind').textContent = info.kind;
      this.$('#infoRows').innerHTML = info.rows.map(([a, b]) => `<tr><th>${a}</th><td>${b}</td></tr>`).join('');
      const wk = this.$('#infoWorkers');
      wk.innerHTML = info.workers ? `<h4>Працівники</h4>` + (info.workers.length ? '' : '<div class="none">немає</div>') : '';
      for (const x of info.workers ?? []) {
        const d = document.createElement('div'); d.className = 'row'; d.dataset.key = String(x.id); d.textContent = `${x.name}: ${x.state}`; wk.append(d);
      }
      const it = this.$('#infoItems');
      it.innerHTML = info.items ? `<h4>${info.itemsTitle ?? ''}</h4>` : '';
      for (const x of info.items ?? []) {
        const d = document.createElement('div'); d.className = 'row'; d.dataset.sel = JSON.stringify(x.sel); d.textContent = x.text; it.append(d);
      }
      box.classList.toggle('bad', !!info.warn);
      const asg = this.$('#infoAssign');
      asg.innerHTML = info.assign ? '<h4>Призначити на роботу</h4>' + (info.assign.length ? info.assign.map((a) => `<button class="k-btn" data-b="${a.building}">${a.label}</button>`).join('') : '<div class="none">вільних місць немає</div>') : '';
      this.$('#infoFree').hidden = !info.canUnassign;
      const sl = this.$('#infoSlots'); sl.hidden = !info.slots;
      if (info.slots) this.$('#slotNum').textContent = `${info.slots.cur}/${info.slots.cap}`;
    }
    const f = this.$('#infoFollow'), t = st.following ? '📍 Камера слідує' : '📍 Слідкувати';
    if (f.textContent !== t) f.textContent = t;
    f.classList.toggle('sel', st.following);
    const pb = this.$('button[data-pause]');
    pb.hidden = !info.canPause;
    const pl = info.paused ? '▶ Пуск' : '⏸ Пауза';
    if (pb.textContent !== pl) pb.textContent = pl;
    const dm = this.$('#infoDemolish'); dm.hidden = !info.canDemolish;
    if (dm.hidden) { dm.classList.remove('arm'); dm.textContent = 'Знести'; }
  }

  destroy(): void { window.clearTimeout(this.msgTimer); window.removeEventListener('keydown', this.onKey, true); this.wm.destroy(); this.root.remove(); }
}
