import type { BuildingKind } from '../../shared';
import { buildCheck } from '../../sim';
import { COSTS } from '../../sim/balance';
import { BUILD_NAMES, RES_NAMES } from '../info';
import { esc } from '../rows';
import type { Section } from '../windows';

/** Вкладки будівництва. Споруда без запису тут потрапляє у «Ресурси». Порожні вкладки показують заглушку. */
export const BUILD_TABS: { id: string; title: string; kinds: BuildingKind[]; soon: string }[] = [
  { id: 'housing', title: 'Житло', kinds: ['house'], soon: '' },
  { id: 'resources', title: 'Ресурси', kinds: ['lumberjack', 'quarry', 'sawmill', 'farm', 'hunter', 'fisher', 'warehouse'], soon: '' },
  { id: 'mood', title: 'Настрій', kinds: [], soon: 'Тут з’являться споруди для настрою жителів: свята, розваги, прикраси.' },
  { id: 'defense', title: 'Захист', kinds: [], soon: 'Тут з’являться стіни й вежі.' },
];
const BUILDABLE = Object.keys(BUILD_NAMES).filter((k) => k !== 'townhall') as BuildingKind[];
/** Вкладка, у якій стоїть споруда. */
export const tabOfBuilding = (k: BuildingKind): string => BUILD_TABS.find((t) => t.kinds.includes(k))?.id ?? 'resources';
const missingText = (m: Record<string, number>) => Object.entries(m).map(([r, v]) => `${v} ${RES_NAMES[r]?.toLowerCase() ?? r}`).join(', ');

export const buildSection: Section = {
  id: 'build', icon: 'build', title: 'Будівництво', place: 'dock',
  tabs: BUILD_TABS.map((t) => ({ id: t.id, title: t.title })),
  mount(panes, { hooks, w, player }) {
    let picked: BuildingKind | null = null;
    for (const t of BUILD_TABS) {
      const kinds = BUILDABLE.filter((k) => tabOfBuilding(k) === t.id);
      panes[t.id].innerHTML = kinds.length
        ? `<div class="k-grid">${kinds.map((k) => `<button class="k-card" data-k="${k}"><b>${esc(BUILD_NAMES[k]!)}</b><span class="chips">${
          Object.entries(COSTS[k] ?? {}).map(([r, v]) => `<span class="k-chip" data-r="${r}"><i class="k-pip ${r}"></i>${v}</span>`).join('')}</span></button>`).join('')}</div>`
        : `<div class="k-empty">${esc(t.soon)}</div>`;
    }
    for (const t of BUILD_TABS) panes[t.id].onclick = (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-k]');
      if (b) hooks.pickBuild(picked === b.dataset.k ? null : (b.dataset.k as BuildingKind));
    };
    return (st, tab) => {
      picked = st.build;
      panes[tab].querySelectorAll<HTMLButtonElement>('button[data-k]').forEach((btn) => {
        const k = btn.dataset.k as BuildingKind, c = buildCheck(w, player, k);
        btn.classList.toggle('no', !c.ok); btn.classList.toggle('sel', st.build === k);
        btn.title = c.ok ? (c.free ? 'Перший лісоруб безкоштовний' : '') : `Не вистачає: ${missingText(c.missing)}`;
        btn.querySelectorAll<HTMLElement>('.k-chip').forEach((chip) => chip.classList.toggle('no', ((c.missing as Record<string, number>)[chip.dataset.r!] ?? 0) > 0));
      });
    };
  },
};
