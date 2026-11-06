import {
  SAVE_MAGIC, SAVE_VERSION, migrateSave,
  type GameState, type SaveFile,
} from '../shared';
import { deserialize, serialize, type SimWorld } from '../sim';

export const GAME_VERSION = '0.0.1';

/** Помилка збереження/завантаження з текстом, придатним для показу гравцю. */
export class SaveError extends Error {}

const DEFAULT_SPEED = 1;

/** Знімок світу (включно зі стежками, залишками вузлів, NPC з іменами/статами/перками, підскладами) і швидкості. */
export function createSave(w: SimWorld, opts: { speed?: number; now?: Date } = {}): SaveFile {
  return {
    magic: SAVE_MAGIC, version: SAVE_VERSION, savedAt: (opts.now ?? new Date()).toISOString(),
    gameVersion: GAME_VERSION, compression: 'none', speed: opts.speed ?? DEFAULT_SPEED, state: serialize(w),
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

const migrationError = (e: unknown): SaveError => {
  const m = e instanceof Error ? e.message : String(e);
  if (m.includes('новішої')) return new SaveError('Сейв створено новішою версією гри. Онови сторінку (Ctrl+F5) і спробуй ще раз.');
  if (m.includes('Немає міграції')) return new SaveError('Сейв надто старий і несумісний з цією версією гри: почни нову гру.');
  return new SaveError(m.includes('почни нову гру') ? m : `Сейв несумісний з цією версією гри: почни нову гру. (${m})`);
};

/** Байти -> SaveFile (з міграціями до поточної версії). Кидає SaveError зі зрозумілим текстом. */
export async function decodeSave(bytes: Uint8Array): Promise<SaveFile> {
  let json: string;
  try {
    const raw = isGzip(bytes) ? await pipe(bytes, new DecompressionStream('gzip')) : bytes;
    json = new TextDecoder().decode(raw);
  } catch { throw new SaveError('Файл не схожий на сейв (пошкоджений архів)'); }
  let obj: { magic?: unknown; version?: unknown };
  try { obj = JSON.parse(json); } catch { throw new SaveError('Файл не схожий на сейв (не JSON)'); }
  if (!obj || obj.magic !== SAVE_MAGIC) throw new SaveError('Це не сейв «Балаганників»');
  if (typeof obj.version !== 'number') throw new SaveError('У сейві немає версії');
  let save: SaveFile;
  try { save = migrateSave(obj as { version: number }); } catch (e) { throw migrationError(e); }
  const st = save.state as Partial<SaveFile['state']> | undefined;
  if (!st || !Array.isArray(st.players) || !Array.isArray(st.sectors) || !Array.isArray(st.buildings) || !st.npcs || !st.world) {
    throw new SaveError('Сейв пошкоджений (бракує частини даних)');
  }
  return save;
}

/** Завантажений сейв: світ симуляції й збережена швидкість. */
export interface LoadedGame { world: SimWorld; speed: number }
const loadedByState = new WeakMap<GameState, LoadedGame>();

/** SaveFile -> робочий світ (npc/трафік/вузли відновлено, працівники прив'язані до будівель). */
export function loadGame(save: SaveFile): LoadedGame {
  let world: SimWorld;
  try { world = deserialize(save.state); } catch (e) {
    throw new SaveError(`Не вдалося відновити гру із сейва: почни нову гру. (${e instanceof Error ? e.message : e})`);
  }
  const speed = typeof save.speed === 'number' && save.speed >= 0 ? save.speed : DEFAULT_SPEED;
  const g = { world, speed };
  loadedByState.set(world.state, g);
  return g;
}

/** Для лобі: стан із сейва. Повний світ забирає main через takeLoaded. */
export const loadState = (save: SaveFile): GameState => loadGame(save).world.state;
export const takeLoaded = (state: GameState): LoadedGame | undefined => loadedByState.get(state);
