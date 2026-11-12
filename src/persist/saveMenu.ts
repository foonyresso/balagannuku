import type { SaveController } from './controller';

const CSS = `
#saveMenu{position:fixed;right:0.8em;top:3.4em;z-index:60;font:calc(13px * var(--ui,1))/1.4 sans-serif;color:var(--k-text,#eee);text-align:right}
#saveMenu .p{display:none;margin-top:0.4em;padding:0.6em;flex-direction:column;gap:0.4em;align-items:stretch;min-width:14em}
#saveMenu.open .p{display:flex}
#saveMenu .st{font-size:0.9em;color:var(--k-teal,#9ad);text-align:left;min-height:1.3em;max-width:18em}
#saveMenu .st.bad{color:var(--k-red,#f77)}
`;

export interface SaveMenuHooks {
  /** Користувач завантажив сейв з файлу (замінює поточну гру). */
  onLoad(): void | Promise<void>;
  visible(): boolean;
}

/** Плаваюча кнопка «Збереження»: зберегти, експорт у файл, завантаження з файлу, статус. */
export function mountSaveMenu(ctl: SaveController, hooks: SaveMenuHooks): { refresh(): void; destroy(): void } {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'saveMenu';
  root.innerHTML = `<button id="saveToggle" class="k-btn">Збереження</button>
    <div class="p k-frame"><button id="saveNow" class="k-btn">Зберегти (автосейв)</button><button id="saveFile" class="k-btn">Зберегти у файл…</button>
    <button id="loadFile" class="k-btn">Завантажити з файлу…</button><div class="st" id="saveSt"></div></div>`;
  document.body.appendChild(root);
  const st = root.querySelector<HTMLElement>('#saveSt')!;
  const show = (text: string, error: boolean) => { st.textContent = text; st.classList.toggle('bad', error); };
  const idle = () => {
    show(ctl.last ? `Останнє автозбереження: ${new Date(ctl.last.savedAt).toLocaleTimeString('uk-UA')}` : 'Автозбереження ще не було', false);
  };
  ctl.onStatus = (s) => show(s.text, s.error);
  const wrap = (f: () => Promise<unknown>) => async () => { try { await f(); } catch (e) { show(e instanceof Error ? e.message : String(e), true); } };
  root.querySelector<HTMLElement>('#saveToggle')!.onclick = () => { root.classList.toggle('open'); idle(); };
  root.querySelector<HTMLElement>('#saveNow')!.onclick = wrap(() => ctl.saveNow());
  root.querySelector<HTMLElement>('#saveFile')!.onclick = wrap(() => ctl.exportFile());
  root.querySelector<HTMLElement>('#loadFile')!.onclick = wrap(async () => { await hooks.onLoad(); });
  const refresh = () => { root.style.display = hooks.visible() ? '' : 'none'; };
  refresh();
  return { refresh, destroy: () => { root.remove(); style.remove(); } };
}
