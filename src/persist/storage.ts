import { SAVE_EXTENSION, type GameState, type SaveFile } from '../shared';
import { createSave, decodeSave, encodeSave } from './saveFile';

const DB = 'balagannuku', STORE = 'saves', AUTO_KEY = 'autosave';

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((res, rej) => {
      const r = f(db.transaction(STORE, mode).objectStore(STORE));
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  } finally { db.close(); }
}

/** Автозбереження в IndexedDB — лише страховка. Помилки не кидає (повертає false). */
export async function autosave(state: GameState): Promise<boolean> {
  try {
    const bytes = await encodeSave(createSave(state));
    await tx('readwrite', (s) => s.put(bytes, AUTO_KEY));
    return true;
  } catch { return false; }
}

export async function loadAutosave(): Promise<SaveFile | null> {
  try {
    const bytes = await tx<Uint8Array | undefined>('readonly', (s) => s.get(AUTO_KEY));
    return bytes ? await decodeSave(bytes) : null;
  } catch { return null; }
}

type FsWindow = Window & {
  showSaveFilePicker?: (o: unknown) => Promise<{ createWritable(): Promise<{ write(d: BufferSource): Promise<void>; close(): Promise<void> }> }>;
  showOpenFilePicker?: (o: unknown) => Promise<Array<{ getFile(): Promise<File> }>>;
};
const w = () => window as FsWindow;
const fname = () => `balagannuku-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}${SAVE_EXTENSION}`;

/** Зберегти у файл: File System Access (Chrome/Edge), інакше завантаження. */
export async function saveToFile(state: GameState): Promise<void> {
  const bytes = await encodeSave(createSave(state));
  if (w().showSaveFilePicker) {
    try {
      const h = await w().showSaveFilePicker!({ suggestedName: fname(), types: [{ description: 'Сейв', accept: { 'application/octet-stream': [SAVE_EXTENSION] } }] });
      const wr = await h.createWritable();
      await wr.write(bytes as BufferSource);
      await wr.close();
      return;
    } catch (e) { if ((e as Error).name === 'AbortError') return; /* інакше — фолбек */ }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart]));
  a.download = fname();
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Обрати сейв з диска. null — користувач скасував. */
export async function pickSaveFile(): Promise<SaveFile | null> {
  let file: File | null = null;
  if (w().showOpenFilePicker) {
    try { file = await (await w().showOpenFilePicker!({ types: [{ description: 'Сейв', accept: { 'application/octet-stream': [SAVE_EXTENSION] } }] }))[0].getFile(); }
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
