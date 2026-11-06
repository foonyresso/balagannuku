import type { BuildingKind } from '../shared';
import { buildCheck, residents, type SimWorld } from '../sim';
import { COSTS, MAX_WORKERS } from '../sim/balance';
import { npcName } from './names';
import { BUILD_NAMES, describeSel, RES_NAMES, stateText, PROF_TXT, type Sel } from './info';
import { SPEEDS } from './pacer';
import './cityHud.css';

export type Tab = 'build' | 'people' | 'prod';
export interface HudHooks {
  pickBuild(k: BuildingKind | null): void;
  select(sel: Sel, follow: boolean): void;
  deselect(): void;
  follow(on: boolean): void;
  back(): void;
  speed(s: number): void;
  pause(id: number): void;
  demolish(id: number): void;
}
export interface HudState {
  selected: Sel | null; build: BuildingKind | null; following: boolean;
  /** Цільова й фактична швидкість гри; locked — керує хост. */
  speed: number; actualSpeed: number; speedLocked: boolean;
}

const BUILDABLE = Object.keys(BUILD_NAMES).filter((k) => k !== 'townhall') as BuildingKind[];
const TABS: [Tab, string][] = [['build', '🔨 Будівництво'], ['people', '👥 Жителі'], ['prod', '📊 Виробництво']];
const cost = (k: BuildingKind) => Object.entries(COSTS[k] ?? {}).map(([r, v]) => `${v} ${RES_NAMES[r]?.toLowerCase()}`).join(', ');

type RowMap = Map<number, { el: HTMLElement; text: string }>;
/** Рядки списку живуть постійно й оновлюються на місці (а не перебудовуються): клік не губиться між mousedown і mouseup. */
function syncRows(host: HTMLElement, map: RowMap, items: { key: number; text: string; cls?: string }[]): void {
  const keys = new Set(items.map((i) => i.key));
  let changed = false;
  for (const [k, r] of map) if (!keys.has(k)) { r.el.remove(); map.delete(k); changed = true; }
  for (const it of items) {
    let r = map.get(it.key);
    if (!r) {
      const el = document.createElement('div');
      el.className = 'row'; el.dataset.key = String(it.key);
      r = { el, text: '' }; map.set(it.key, r); changed = true;
    }
    if (r.text !== it.text) { r.el.textContent = it.text; r.text = it.text; }
    r.el.classList.toggle('bad', !!it.cls);
  }
  if (changed) for (const it of items) host.append(map.get(it.key)!.el);
}

/** Нижня панель вкладок, верхня смуга ресурсів і вікно інформації про виділений об'єкт. */
export class CityHud {
  readonly root = document.createElement('div');
  tab: Tab | null = 'build';
  private $ = (s: string) => this.root.querySelector<HTMLElement>(s)!;
  private peopleRows: RowMap = new Map();
  private prodRows: RowMap = new Map();
  private infoSig = '';
  private msgTimer: number | undefined;

  constructor(hooks: HudHooks, private w: SimWorld, private player: string, private sector: number) {
    this.root.id = 'cityHud';
    this.root.innerHTML = `
      <div id="cityTop"><span id="cityRes"></span><span id="citySpeed">${SPEEDS.map((v) => `<button data-speed="${v}" title="${v ? v + '×' : 'Пауза (Пробіл)'}">${v ? v + '×' : '⏸'}</button>`).join('')}<small id="speedActual"></small></span><button id="cityBack">← До карти</button></div>
      <div id="cityInfo" hidden>
        <div class="hd"><div><h3 id="infoTitle"></h3><small id="infoKind"></small></div><button id="infoClose" title="Закрити (Esc)">×</button></div>
        <table id="infoRows"></table>
        <div id="infoWorkers"></div>
        <div class="acts"><button id="infoFollow"></button><button data-pause hidden></button><button id="infoDemolish" hidden>Знести</button></div>
      </div>
      <div id="cityMsg"></div>
      <div id="cityBottom">
        <div id="cityBody">
          <div data-body="build" class="btns">${BUILDABLE.map((k) => `<button data-k="${k}"><b>${BUILD_NAMES[k]}</b><small>${cost(k)}</small></button>`).join('')}</div>
          <div data-body="people" class="list"></div>
          <div data-body="prod" class="list"></div>
        </div>
        <div id="cityTabs">${TABS.map(([t, l]) => `<button data-tab="${t}">${l}</button>`).join('')}<span id="cityHint"></span></div>
      </div>`;
    document.body.appendChild(this.root);
    const on = (sel: string, fn: (t: HTMLElement) => void, ev = 'click') => this.root.addEventListener(ev, (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>(sel);
      if (t && this.root.contains(t)) fn(t);
    });
    on('button[data-k]', (b) => hooks.pickBuild(this.lastBuild === b.dataset.k ? null : (b.dataset.k as BuildingKind)));
    on('button[data-speed]', (b) => hooks.speed(Number(b.dataset.speed)));
    on('button[data-tab]', (b) => { this.tab = this.tab === b.dataset.tab ? null : (b.dataset.tab as Tab); this.showTab(); this.update(this.st); });
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
    // Рядки списків/працівників спрацьовують на pointerdown: вміст оновлюється, і click може не дійти.
    const pick = (sel: Sel) => hooks.select(sel, sel.t === 'npc');
    on('[data-body=people] .row', (r) => pick({ t: 'npc', id: Number(r.dataset.key) }), 'pointerdown');
    on('[data-body=prod] .row', (r) => pick({ t: 'building', id: Number(r.dataset.key) }), 'pointerdown');
    on('#infoWorkers .row', (r) => pick({ t: 'npc', id: Number(r.dataset.key) }), 'pointerdown');
    this.showTab();
  }

  private st: HudState = { selected: null, build: null, following: false, speed: 1, actualSpeed: 1, speedLocked: false };
  private lastBuild: BuildingKind | null = null;
  private lastFollow = false;
  private lastSelBuilding: number | null = null;

  private showTab(): void {
    this.root.querySelectorAll<HTMLElement>('[data-body]').forEach((e) => { e.hidden = e.dataset.body !== this.tab; });
    this.root.querySelectorAll<HTMLElement>('button[data-tab]').forEach((b) => b.classList.toggle('sel', b.dataset.tab === this.tab));
    this.$('#cityBody').hidden = this.tab === null;
  }

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
    const w = this.w, seed = w.state.world.seed;
    this.lastBuild = st.build; this.lastFollow = st.following;
    this.updateSpeed(st);
    const p = w.state.players.find((x) => x.id === this.player)!;
    const list = residents(w, this.player);
    const idle = list.filter((r) => r.workplace < 0).length;
    this.$('#cityRes').innerHTML = Object.entries(RES_NAMES).map(([k, n]) => `${n}: <b>${p.resources[k as 'wood']}</b>`).join(' · ') +
      ` · Жителів: <b>${list.length}</b>, вільних: <b>${idle}</b>`;
    this.root.querySelectorAll<HTMLButtonElement>('button[data-k]').forEach((btn) => {
      const k = btn.dataset.k as BuildingKind, c = buildCheck(w, this.player, k);
      btn.classList.toggle('no', !c.ok); btn.classList.toggle('sel', st.build === k);
      btn.title = c.ok ? (c.free ? 'Перший лісоруб безкоштовний' : '') : `Не вистачає: ${this.missingText(k)}`;
    });
    this.$('#cityHint').textContent = st.build
      ? `Будівництво: ${BUILD_NAMES[st.build]} — клік по землі, Esc або ПКМ — скасувати`
      : 'Клікни по жителю, споруді, дереву чи дорозі, щоб побачити інформацію';
    if (this.tab === 'people') {
      syncRows(this.$('[data-body=people]'), this.peopleRows, list.map((r) => ({
        key: r.id, text: `${npcName(seed, r.id)} · ${PROF_TXT[r.profession] ?? r.profession}${r.workplace >= 0 ? ` #${r.workplace}` : ''}: ${stateText(r)}`,
        cls: r.state === 'no_path' ? 'x' : undefined,
      })).slice(0, 300));
      this.markSel(this.peopleRows, st.selected?.t === 'npc' ? st.selected.id : -1);
    }
    if (this.tab === 'prod') {
      const live = w.state.buildings.filter((b) => b.owner === this.player);
      const infos = live.map((b) => ({ b, i: describeSel(w, this.player, this.sector, { t: 'building', id: b.id }) }));
      syncRows(this.$('[data-body=prod]'), this.prodRows, infos.map(({ b, i }) => {
        const get = (n: string) => i?.rows.find((r) => r[0] === n)?.[1];
        const max = MAX_WORKERS[b.kind];
        const parts = [get('Стан'), max ? `працівників ${b.workers.length}/${max}` : '', get('Ефективність') ? `ефективність ${get('Ефективність')}` : '', get('Виробіток')].filter(Boolean);
        return { key: b.id, text: `${i?.title}: ${parts.join(' · ')}`, cls: i?.warn ? 'x' : undefined };
      }));
      this.markSel(this.prodRows, st.selected?.t === 'building' ? st.selected.id : -1);
    }
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

  private markSel(map: RowMap, id: number): void { for (const [k, r] of map) r.el.classList.toggle('sel', k === id); }

  private updateInfo(st: HudState): void {
    const box = this.$('#cityInfo');
    const info = st.selected ? describeSel(this.w, this.player, this.sector, st.selected) : null;
    box.hidden = !info;
    this.lastSelBuilding = info?.building ?? null;
    if (!info) { this.infoSig = ''; return; }
    const sig = JSON.stringify([info.title, info.kind, info.rows, info.workers, info.warn]);
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
      box.classList.toggle('bad', !!info.warn);
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

  destroy(): void { window.clearTimeout(this.msgTimer); this.root.remove(); }
}
