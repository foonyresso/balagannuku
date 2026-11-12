import { slotsOf } from '../../sim';
import { describeSel, RES_NAMES } from '../info';
import { esc, syncRows, type RowMap } from '../rows';
import type { Section } from '../windows';

export const economySection: Section = {
  id: 'economy', icon: 'economy', title: 'Економіка', place: 'center',
  tabs: [{ id: 'prod', title: 'Виробництво' }, { id: 'res', title: 'Ресурси' }],
  mount(panes, { hooks, w, player, sector }) {
    const rows: RowMap = new Map();
    panes.prod.innerHTML = '<div class="k-list"></div>';
    const list = panes.prod.firstElementChild as HTMLElement;
    panes.prod.addEventListener('pointerdown', (e) => {
      const r = (e.target as HTMLElement).closest<HTMLElement>('.row');
      if (r) hooks.select({ t: 'building', id: Number(r.dataset.key) }, false);
    });
    panes.res.innerHTML = `<div class="k-grid">${Object.entries(RES_NAMES).map(([k, n]) => `<div class="k-card" data-res="${k}"><i class="k-pip ${k}"></i> ${esc(n)}<b class="big"></b></div>`).join('')}</div>`;
    return (st, tab) => {
      if (tab === 'res') {
        const p = w.state.players.find((x) => x.id === player)!;
        panes.res.querySelectorAll<HTMLElement>('[data-res]').forEach((c) => {
          const b = c.querySelector('b')!, t = String(p.resources[c.dataset.res as 'wood']);
          if (b.textContent !== t) b.textContent = t;
        });
        return;
      }
      const live = w.state.buildings.filter((b) => b.owner === player);
      const infos = live.map((b) => ({ b, i: describeSel(w, player, sector, { t: 'building', id: b.id }) }));
      syncRows(list, rows, infos.map(({ b, i }) => {
        const get = (n: string) => i?.rows.find((r) => r[0] === n)?.[1];
        const max = slotsOf(b);
        const parts = [get('Стан'), max ? `працівників ${b.workers.length}/${max}` : '', get('Ефективність') ? `ефективність ${get('Ефективність')}` : '', get('Виробіток')].filter(Boolean);
        return { key: b.id, html: `<b>${esc(i?.title ?? '')}</b><small>${esc(parts.join(' · '))}</small>`, cls: i?.warn ? 'x' : undefined, sel: st.selected?.t === 'building' && st.selected.id === b.id };
      }), 'row k-card');
    };
  },
};
