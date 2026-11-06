import { SAVE_EXTENSION, type SaveFile } from '../shared';
import type { SimWorld } from '../sim';
import { createSave, decodeSave, encodeSave, SaveError } from './saveFile';

const DB = 'balagannuku', STORE = 'saves', AUTO_KEY = 'autosave', PREV_KEY = 'autosave-prev', META_KEY = 'autosave-meta';

export interface SaveInfo { savedAt: string; tick: number; bytes: number }

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') return rej(new Error('IndexedDB недоступна'));
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('База заблокована іншою вкладкою'));
  });
}

/** Одна транзакція: усе або нічого (стара копія не псується, якщо запис не вдався). */
async function run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => Promise<T> | T): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((res, rej) => {
      const t = db.transaction(STORE, mode);
      const s = t.objectStore(STORE);
      let out!: T;
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error ?? new Error('Транзакцію скасовано'));
      Promise.resolve(f(s)).then((v) => { out = v; }, rej);
    });
  } finally { db.close(); }
}

const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const describeStorageError = (e: unknown): string => {
  const n = (e as { name?: string } | null)?.name;
  if (n === 'QuotaExceededError') return 'Не вистачає місця в браузері для автозбереження. Збережи у файл.';
  if (e instanceof SaveError) return e.message;
  return `Браузер не дає зберегти в автозбереження (${e instanceof Error ? e.message : e}). Збережи у файл.`;
};

/** Автозбереження в IndexedDB (поточне + попереднє). Не кидає: повертає інформацію або текст помилки. */
export async function autosave(w: SimWorld, speed = 1): Promise<{ ok: true; info: SaveInfo } | { ok: false; error: string }> {
  try {
    const save = createSave(w, { speed });
    const bytes = await encodeSave(save);
    const info: SaveInfo = { savedAt: save.savedAt, tick: w.state.tick, bytes: bytes.length };
    await run('readwrite', async (s) => {
      const cur = await req(s.get(AUTO_KEY));
      if (cur) s.put(cur, PREV_KEY);
      s.put(bytes, AUTO_KEY);
      s.put(info, META_KEY);
    });
    return { ok: true, info };
  } catch (e) { return { ok: false, error: describeStorageError(e) }; }
}

/** Метадані останнього автосейва (без розпаковки); null — його немає. */
export async function autosaveInfo(): Promise<SaveInfo | null> {
  try { return (await run('readonly', (s) => req<SaveInfo | undefined>(s.get(META_KEY)))) ?? null; } catch { return null; }
}

/**
 * Останній автосейв. null — його немає. Якщо основний не читається, пробує попередній;
 * якщо несумісний/пошкоджений — кидає SaveError з текстом для гравця.
 */
export async function loadAutosave(): Promise<SaveFile | null> {
  let main: Uint8Array | undefined, prev: Uint8Array | undefined;
  try {
    [main, prev] = await run('readonly', async (s) => [await req<Uint8Array | undefined>(s.get(AUTO_KEY)), await req<Uint8Array | undefined>(s.get(PREV_KEY))] as const);
  } catch (e) { throw new SaveError(`Не вдалося прочитати автозбереження: ${e instanceof Error ? e.message : e}`); }
  if (!main) return null;
  try { return await decodeSave(main); } catch (e) {
    if (prev) { try { return await decodeSave(prev); } catch { /* показуємо першу помилку */ } }
    throw e;
  }
}

type FsWindow = Window & {
  showSaveFilePicker?: (o: unknown) => Promise<{ createWritable(): Promise<{ write(d: BufferSource): Promise<void>; close(): Promise<void> }> }>;
  showOpenFilePicker?: (o: unknown) => Promise<Array<{ getFile(): Promise<File> }>>;
};
const w = () => window as FsWindow;
const fname = () => `balagannuku-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}${SAVE_EXTENSION}`;
const types = [{ description: 'Сейв «Балаганників»', accept: { 'application/octet-stream': [SAVE_EXTENSION] } }];

/** Зберегти у файл: File System Access (Chrome/Edge), інакше завантаження файлу. true — збережено, false — скасовано. */
export async function saveToFile(world: SimWorld, speed = 1): Promise<boolean> {
  const bytes = await encodeSave(createSave(world, { speed }));
  if (w().showSaveFilePicker) {
    try {
      const h = await w().showSaveFilePicker!({ suggestedName: fname(), types });
      const wr = await h.createWritable();
      await wr.write(bytes as BufferSource);
      await wr.close();
      return true;
    } catch (e) { if ((e as Error).name === 'AbortError') return false; /* інакше — запасне завантаження */ }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart]));
  a.download = fname();
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return true;
}

/** Обрати сейв з диска. null — користувач скасував. Кидає SaveError, якщо файл не підходить. */
export async function pickSaveFile(): Promise<SaveFile | null> {
  let file: File | null = null;
  if (w().showOpenFilePicker) {
    try { file = await (await w().showOpenFilePicker!({ types }))[0].getFile(); }
    catch (e) { if ((e as Error).name === 'AbortError') return null; }
  }
  if (!file) {
    file = await new Promise<File | null>((res) => {
      const i = document.createElement('input');
      i.type = 'file'; i.accept = SAVE_EXTENSION;
      i.onchange = () => res(i.files?.[0] ?? null);
      i.oncancel = () => res(null);
      i.click();
    });
  }
  return file ? decodeSave(new Uint8Array(await file.arrayBuffer())) : null;
}
