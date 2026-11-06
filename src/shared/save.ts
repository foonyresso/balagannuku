import type { SerializedGameState } from './state';

/** Поточна версія формату сейва. Підвищуй при КОЖНІЙ зміні форми SerializedGameState. */
export const SAVE_VERSION = 3;
export const SAVE_MAGIC = 'balagannuku-save';
export const SAVE_EXTENSION = '.save';

export interface SaveFile {
  magic: typeof SAVE_MAGIC;
  /** Версія формату. Старші сейви мігруються до SAVE_VERSION при завантаженні. */
  version: number;
  savedAt: string; // ISO
  gameVersion: string;
  compression: 'none' | 'gzip'; // gzip — на рівні файлу, цей заголовок завжди JSON-читабельний
  state: SerializedGameState;
}

/** Міграція з версії N на N+1. Чиста функція, не мутує вхід. */
export type SaveMigration = (old: unknown) => unknown;

/**
 * Реєстр міграцій: ключ N — міграція з версії N на N+1.
 * Додаючи нову версію: поклади міграцію в MIGRATIONS[старa_версія] і підніми SAVE_VERSION.
 * Приклад: MIGRATIONS[1] = (s) => ({ ...s, version: 2, state: {...} }).
 */
export const MIGRATIONS: Record<number, SaveMigration> = {
  // v1 -> v2: облік потоків (flows) і залишки вузлів ресурсів у секторах.
  1: (old) => {
    const f = old as { version: number; state: { sectors: object[] } & Record<string, unknown> };
    const snap = () => ({ byBuilding: {}, edges: {} });
    return {
      ...f,
      version: 2,
      state: {
        ...f.state,
        sectors: f.state.sectors.map((s) => ({ ...s, nodes: null })),
        flows: { windowTicks: 100, windowStart: 0, cur: snap(), last: snap(), total: snap() },
      },
    };
  },
  // v2 -> v3: дрібна сітка тайлів (4×4 на клітинку). Світ без міста переносимо; з містом — чесно відхиляємо.
  2: (old) => {
    const f = old as { version: number; state: { buildings: unknown[]; npcs: { count: number }; sectors: object[] } & Record<string, unknown> };
    if (f.state.buildings.length > 0 || f.state.npcs.count > 0) {
      throw new Error('Сейв із містом старого формату (до дрібної сітки тайлів) не підтримується: почни нову гру.');
    }
    return { ...f, version: 3, state: { ...f.state, sectors: f.state.sectors.map((s) => ({ ...s, trails: null })) } };
  },
};

export function migrateSave(raw: { version: number }): SaveFile {
  let cur: unknown = raw;
  let v = raw.version;
  if (v > SAVE_VERSION) throw new Error(`Сейв новішої версії (${v}) за підтримувану (${SAVE_VERSION})`);
  while (v < SAVE_VERSION) {
    const m = MIGRATIONS[v];
    if (!m) throw new Error(`Немає міграції з версії ${v}`);
    cur = m(cur);
    v++;
  }
  return cur as SaveFile;
}
