import {
  SAVE_MAGIC, SAVE_VERSION, migrateSave,
  type GameState, type SaveFile,
} from '../shared';
import { packState, unpackState } from './pack';

export const GAME_VERSION = '0.0.1';

export function createSave(state: GameState, now = new Date()): SaveFile {
  return {
    magic: SAVE_MAGIC, version: SAVE_VERSION, savedAt: now.toISOString(),
    gameVersion: GAME_VERSION, compression: 'none', state: packState(state),
  };
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

const isGzip = (b: Uint8Array) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;

/** SaveFile -> байти файлу. Gzip усього файлу (визначається за сигнатурою при читанні). */
export async function encodeSave(save: SaveFile, gzip = true): Promise<Uint8Array> {
  const json = new TextEncoder().encode(JSON.stringify({ ...save, compression: gzip ? 'gzip' : 'none' }));
  return gzip ? pipe(json, new CompressionStream('gzip')) : json;
}

/** Байти -> SaveFile (з міграціями до поточної версії). Кидає зрозумілу помилку на сміття. */
export async function decodeSave(bytes: Uint8Array): Promise<SaveFile> {
  let json: string;
  try {
    const raw = isGzip(bytes) ? await pipe(bytes, new DecompressionStream('gzip')) : bytes;
    json = new TextDecoder().decode(raw);
  } catch { throw new Error('Файл не схожий на сейв (пошкоджений архів)'); }
  let obj: { magic?: unknown; version?: unknown };
  try { obj = JSON.parse(json); } catch { throw new Error('Файл не схожий на сейв (не JSON)'); }
  if (!obj || obj.magic !== SAVE_MAGIC) throw new Error('Це не сейв «Балаганників»');
  if (typeof obj.version !== 'number') throw new Error('У сейві немає версії');
  return migrateSave(obj as { version: number });
}

export const loadState = (save: SaveFile): GameState => unpackState(save.state);
