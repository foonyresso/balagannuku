import { RES_NAMES } from '../info';
import { esc } from '../rows';
import type { Section } from '../windows';

const SLOTS = 24;

/** Інвентар: запаси ресурсів (реальні дані) і предмети (макет: слоти порожні, поки жителі нічого не приносять). */
export const inventorySection: Section = {
  id: 'inventory', icon: 'inventory', title: 'Інвентар', place: 'center',
  tabs: [{ id: 'res', title: 'Ресурси' }, { id: 'items', title: 'Предмети' }],
  mount(panes, { w, player }) {
    panes.res.innerHTML = `<div class="k-grid">${Object.entries(RES_NAMES).map(([k, n]) => `<div class="k-card" data-res="${k}"><i class="k-pip ${k}"></i> ${esc(n)}<b class="big"></b></div>`).join('')}</div>`;
    panes.items.innerHTML = `<div class="inv-grid">${'<i></i>'.repeat(SLOTS)}</div><div class="k-empty">Тут будуть предмети й лут, які жителі приноситимуть із походів. Поки що порожньо.</div>`;
    return (_st, tab) => {
      if (tab !== 'res') return;
      const p = w.state.players.find((x) => x.id === player)!;
      panes.res.querySelectorAll<HTMLElement>('[data-res]').forEach((c) => {
        const b = c.querySelector('b')!, t = String(p.resources[c.dataset.res as 'wood']);
        if (b.textContent !== t) b.textContent = t;
      });
    };
  },
};
