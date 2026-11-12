/** Рядки списку живуть постійно й оновлюються на місці (а не перебудовуються): клік не губиться між mousedown і mouseup. */
export type RowMap = Map<number, { el: HTMLElement; html: string }>;
export interface RowItem { key: number; html: string; cls?: string; sel?: boolean }

export const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** `base` — класи рядка (`row`, `row k-card`). Порядок у DOM змінюємо лише при додаванні/видаленні. */
export function syncRows(host: HTMLElement, map: RowMap, items: RowItem[], base = 'row'): void {
  const keys = new Set(items.map((i) => i.key));
  let changed = false;
  for (const [k, r] of map) if (!keys.has(k)) { r.el.remove(); map.delete(k); changed = true; }
  for (const it of items) {
    let r = map.get(it.key);
    if (!r) {
      const el = document.createElement('div');
      el.className = base; el.dataset.key = String(it.key);
      r = { el, html: '' }; map.set(it.key, r); changed = true;
    }
    if (r.html !== it.html) { r.el.innerHTML = it.html; r.html = it.html; }
    r.el.classList.toggle('bad', !!it.cls);
    r.el.classList.toggle('sel', !!it.sel);
  }
  if (changed) for (const it of items) host.append(map.get(it.key)!.el);
}
