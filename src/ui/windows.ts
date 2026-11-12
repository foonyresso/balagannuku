import { icon, type IconName } from './icons';
import type { HudState, SectionCtx } from './hudTypes';

/**
 * Розділ інтерфейсу: кнопка в нижній панелі й вікно. Щоб додати новий, створи файл у `sections/`
 * і додай його в `sections/index.ts`: ні нижня панель, ні вікна не міняються.
 */
export interface Section {
  id: string; icon: IconName; title: string;
  /** dock — пласке вікно над нижньою панеллю; center — вікно в центрі екрана. */
  place: 'dock' | 'center';
  tabs?: { id: string; title: string }[];
  /** Створює вміст: по одному контейнеру на вкладку (без вкладок — `main`). Повертає оновлення (лише коли вікно відкрите). */
  mount(panes: Record<string, HTMLElement>, ctx: SectionCtx): (st: HudState, tab: string) => void;
}
/** Кнопка нижньої панелі без вікна: просто виконує дію (наприклад, вихід на карту). */
export interface ActionSection { id: string; icon: IconName; title: string; action(ctx: SectionCtx): void }
export type DockItem = Section | ActionSection;
const isAction = (s: DockItem): s is ActionSection => 'action' in s;

interface Win { s: Section; el: HTMLElement; btn: HTMLElement; tab: string; update: (st: HudState, tab: string) => void }

/** Нижня панель кнопок-іконок і вікна розділів. Відкрите одне вікно за раз. */
export class WindowManager {
  readonly dock = document.createElement('div');
  private wins = new Map<string, Win>();
  private cur: string | null = null;
  private st: HudState | null = null;

  constructor(host: HTMLElement, sections: DockItem[], ctx: Omit<SectionCtx, 'open'>) {
    this.dock.id = 'cityDock';
    this.dock.className = 'k-frame';
    const full: SectionCtx = { ...ctx, open: (id, tab) => this.open(id, tab) };
    for (const s of sections) {
      const btn = document.createElement('button');
      btn.className = 'k-btn dock-btn'; btn.dataset.win = s.id; btn.title = s.title;
      btn.innerHTML = `${icon(s.icon)}<span>${s.title}</span>`;
      this.dock.append(btn);
      if (isAction(s)) { btn.onclick = () => { this.close(); s.action(full); }; continue; }
      btn.onclick = () => this.toggle(s.id);
      const el = document.createElement('section');
      el.className = 'kwin k-frame'; el.dataset.win = s.id; el.dataset.place = s.place; el.hidden = true;
      const tabs = s.tabs ?? [{ id: 'main', title: '' }];
      el.innerHTML = `<header class="kwin-hd">${icon(s.icon)}<h2 class="k-title">${s.title}</h2><button class="k-btn kwin-x" data-close title="Закрити (Esc)">${icon('close')}</button></header>` +
        (s.tabs ? `<nav class="k-tabs">${tabs.map((t) => `<button class="k-tab" data-wtab="${t.id}">${t.title}</button>`).join('')}</nav>` : '') +
        `<div class="kwin-body">${tabs.map((t) => `<div data-pane="${t.id}" hidden></div>`).join('')}</div>`;
      el.querySelector<HTMLElement>('[data-close]')!.onclick = () => this.close();
      el.querySelectorAll<HTMLElement>('[data-wtab]').forEach((b) => { b.onclick = () => this.setTab(s.id, b.dataset.wtab!); });
      host.append(el);
      const panes: Record<string, HTMLElement> = {};
      el.querySelectorAll<HTMLElement>('[data-pane]').forEach((p) => { panes[p.dataset.pane!] = p; });
      this.wins.set(s.id, { s, el, btn, tab: tabs[0].id, update: s.mount(panes, full) });
    }
    host.append(this.dock);
  }

  get openId(): string | null { return this.cur; }
  /** Розміщення відкритого вікна (для Esc). */
  get openPlace(): 'dock' | 'center' | null { return this.cur ? this.wins.get(this.cur)!.s.place : null; }

  open(id: string, tab?: string): void {
    const w = this.wins.get(id); if (!w) return;
    if (this.cur && this.cur !== id) this.wins.get(this.cur)!.el.hidden = true;
    this.cur = id; w.el.hidden = false;
    if (tab) w.tab = tab;
    this.show();
    if (this.st) w.update(this.st, w.tab);
  }
  close(): void {
    if (this.cur) this.wins.get(this.cur)!.el.hidden = true;
    this.cur = null; this.show();
  }
  toggle(id: string): void { if (this.cur === id) this.close(); else this.open(id); }
  setTab(id: string, tab: string): void {
    const w = this.wins.get(id); if (!w) return;
    w.tab = tab; this.show();
    if (this.st) w.update(this.st, w.tab);
  }

  private show(): void {
    for (const [id, w] of this.wins) {
      const on = id === this.cur;
      w.btn.classList.toggle('sel', on);
      w.el.querySelectorAll<HTMLElement>('[data-pane]').forEach((p) => { p.hidden = !on || p.dataset.pane !== w.tab; });
      w.el.querySelectorAll<HTMLElement>('[data-wtab]').forEach((b) => b.classList.toggle('sel', b.dataset.wtab === w.tab));
    }
  }

  update(st: HudState): void {
    this.st = st;
    if (this.cur) { const w = this.wins.get(this.cur)!; w.update(st, w.tab); }
  }
  /** Позначка на кнопці: розділ «активний» поза вікном (наприклад, іде будівництво). */
  mark(id: string, on: boolean): void { this.wins.get(id)?.btn.classList.toggle('active', on); }
  destroy(): void { this.dock.remove(); this.wins.forEach((w) => w.el.remove()); }
}
