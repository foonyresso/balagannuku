import { esc } from '../rows';
import type { Section } from '../windows';

const KEYS: [string, string][] = [
  ['ЛКМ', 'вибрати жителя, споруду; тягни, щоб виділити рамкою'], ['Shift + ЛКМ', 'додати до виділення'], ['ПКМ / СКМ (тягнути)', 'пересувати камеру'],
  ['Колесо миші', 'наближення й віддалення'], ['Пробіл', 'пауза / продовжити'], ['1 – 5', 'швидкість 1×, 2×, 5×, 10×, 100×'], ['N', 'змінити пору доби'], ['Esc', 'закрити вікно, скасувати будівництво чи виділення'],
];
const MIN = 0.75, MAX = 2;
const readScale = (): number => {
  try { const v = Number(localStorage.getItem('uiScale')); if (v >= MIN && v <= MAX) return v; } catch { /* ignore */ }
  return Number(getComputedStyle(document.documentElement).getPropertyValue('--ui')) || 1;
};

/** Налаштування: масштаб інтерфейсу (той самий `uiScale`, що й на карті) і підказка по керуванню. */
export const settingsSection: Section = {
  id: 'settings', icon: 'settings', title: 'Налаштування', place: 'center',
  tabs: [{ id: 'ui', title: 'Інтерфейс' }, { id: 'keys', title: 'Керування' }],
  mount(panes) {
    panes.ui.innerHTML = `<div class="k-card set-row"><span>Масштаб інтерфейсу</span><input id="hudScale" type="range" min="${MIN}" max="${MAX}" step="0.05"><b id="hudScaleVal"></b></div>`;
    const range = panes.ui.querySelector<HTMLInputElement>('#hudScale')!, val = panes.ui.querySelector<HTMLElement>('#hudScaleVal')!;
    const show = () => { val.textContent = `${Math.round(Number(range.value) * 100)}%`; };
    range.value = String(readScale()); show();
    range.oninput = () => {
      document.documentElement.style.setProperty('--ui', range.value);
      try { localStorage.setItem('uiScale', range.value); } catch { /* ignore */ }
      window.dispatchEvent(new Event('uiscale')); show();
    };
    panes.keys.innerHTML = `<div class="k-list">${KEYS.map(([k, d]) => `<div class="k-card key-row"><kbd>${esc(k)}</kbd><span>${esc(d)}</span></div>`).join('')}</div>`;
    return () => {};
  },
};
