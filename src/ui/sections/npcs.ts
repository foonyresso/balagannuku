import { residents, type Resident } from '../../sim';
import { PROF_TXT, stateText } from '../info';
import { nameOf } from '../names';
import { npcDetail } from '../npcDetail';
import { esc, syncRows, type RowMap } from '../rows';
import type { HudState } from '../hudTypes';
import type { Section } from '../windows';

type Filter = 'all' | 'free' | 'busy';

/** Жителі картками (ім'я, професія, чим зайнятий). Клік вибирає жителя; у режимі призначення сажає його в споруду. */
export const npcsSection: Section = {
  id: 'npcs', icon: 'npcs', title: 'Жителі', place: 'center',
  mount(panes, { hooks, w, player, assign }) {
    const rows: RowMap = new Map();
    let filter: Filter = 'all';
    panes.main.innerHTML = `<div class="npc-layout"><div class="npc-col"><div id="peopleFilter">${(['all', 'free', 'busy'] as const).map((f) => `<button class="k-btn" data-f="${f}"></button>`).join('')}</div><div class="k-grid" id="peopleList"></div></div><aside id="npcDetail" class="k-card"></aside></div>`;
    const detail = panes.main.querySelector<HTMLElement>('#npcDetail')!;
    let detailHtml = '', shownId = -1, following = false;
    detail.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-act]');
      if (!b || shownId < 0) return;
      if (b.dataset.act === 'follow') hooks.follow(!following); else hooks.unassign(shownId);
    });
    const list = panes.main.querySelector<HTMLElement>('#peopleList')!;
    let redraw = (): void => {};
    panes.main.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-f]');
      if (b) { filter = b.dataset.f as Filter; redraw(); }
    });
    // Картки спрацьовують на pointerdown: вміст оновлюється, і click може не дійти.
    list.addEventListener('pointerdown', (e) => {
      const r = (e.target as HTMLElement).closest<HTMLElement>('.row');
      if (!r) return;
      const id = Number(r.dataset.key);
      if (assign.target !== null) { hooks.assign(id, assign.target); assign.target = null; return; }
      hooks.select({ t: 'npc', id }, false);
    });
    const drawDetail = (st: HudState, all: Resident[]): void => {
      const sel = st.selected;
      const r = sel?.t === 'npc' ? all.find((x) => x.id === sel.id) : undefined;
      shownId = r?.id ?? -1; following = st.following;
      let html = '<div class="k-empty">Обери жителя зі списку, щоб побачити, хто він і чим займається.</div>';
      if (r) {
        const d = npcDetail(w, r.id);
        html = `<div class="who-hd"><span class="av" data-prof="${esc(r.profession)}">${esc(nameOf(w, r.id).charAt(0))}</span><div><h3 class="k-title">${esc(nameOf(w, r.id))}</h3><small>${esc(PROF_TXT[r.profession] ?? r.profession)}</small></div></div>` +
          `<h4>Зараз</h4><p>${esc(stateText(r))}${r.workplace >= 0 ? `, місце роботи #${r.workplace}` : ''}</p>` +
          `<h4>Стати</h4>${d.stats.map((s) => `<div class="stat"><span>${esc(s.label)}</span><b class="${s.dir > 0 ? 'up' : s.dir < 0 ? 'down' : ''}">${s.text}</b><i class="bar"><i style="width:${s.fill}%"></i></i></div>`).join('')}` +
          `<h4>Перки</h4><div class="chips">${d.perks.length ? d.perks.map((p) => `<span class="k-chip">${esc(p)}</span>`).join('') : '<span class="k-chip">немає</span>'}</div>` +
          `<h4>Предмети</h4><div class="slots"><i></i><i></i><i></i></div><small>Предмети й лут з’являться, коли жителі почнуть їх приносити.</small>` +
          `<div class="acts"><button class="k-btn${st.following ? ' sel' : ''}" data-act="follow">Слідкувати</button>${r.workplace >= 0 ? '<button class="k-btn" data-act="free">Звільнити з роботи</button>' : ''}</div>`;
      }
      if (html !== detailHtml) { detail.innerHTML = html; detailHtml = html; }
    };
    return (st) => {
      redraw = () => {
        const all = residents(w, player);
        const nFree = all.filter((r) => r.workplace < 0).length;
        const names: Record<Filter, string> = { all: `Усі (${all.length})`, free: `Вільні (${nFree})`, busy: `Зайняті (${all.length - nFree})` };
        panes.main.querySelectorAll<HTMLButtonElement>('button[data-f]').forEach((bt) => {
          const t = names[bt.dataset.f as Filter]; if (bt.textContent !== t) bt.textContent = t;
          bt.classList.toggle('sel', bt.dataset.f === filter);
        });
        const shown = all.filter((r) => filter === 'all' || (filter === 'free') === (r.workplace < 0));
        syncRows(list, rows, shown.map((r) => ({
          key: r.id, cls: r.state === 'no_path' ? 'x' : undefined, sel: st.selected?.t === 'npc' && st.selected.id === r.id,
          html: `<span class="av" data-prof="${esc(r.profession)}">${esc(nameOf(w, r.id).charAt(0))}</span><span class="who"><b>${esc(nameOf(w, r.id))}</b>` +
            `<small>${esc(PROF_TXT[r.profession] ?? r.profession)}${r.workplace >= 0 ? ` #${r.workplace}` : ''}</small><small>${esc(stateText(r))}</small></span>`,
        })).slice(0, 300), 'row k-card');
        drawDetail(st, all);
      };
      redraw();
    };
  },
};
