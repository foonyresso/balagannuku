import type { SerializedGameState } from './state';

/** Поточна версія формату сейва. Підвищуй при КОЖНІЙ зміні форми SerializedGameState. */
export const SAVE_VERSION = 10;
export const SAVE_MAGIC = 'balagannuku-save';
export const SAVE_EXTENSION = '.save';

export interface SaveFile {
  magic: typeof SAVE_MAGIC;
  /** Версія формату. Старші сейви мігруються до SAVE_VERSION при завантаженні. */
  version: number;
  savedAt: string; // ISO
  gameVersion: string;
  compression: 'none' | 'gzip'; // gzip — на рівні файлу, цей заголовок завжди JSON-читабельний
  /** Швидкість гри на момент збереження (0 = пауза). Необов'язкове: старі сейви без нього йдуть на 1×. */
  speed?: number;
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
  // v3 -> v4: сектор 256×256 клітинок (1024×1024 тайлів) і нова генерація вузлів. Світ без міста переносимо; з містом — відхиляємо.
  3: (old) => {
    const f = old as { version: number; state: { buildings: unknown[]; npcs: { count: number }; sectors: object[] } & Record<string, unknown> };
    if (f.state.buildings.length > 0 || f.state.npcs.count > 0) {
      throw new Error('Сейв із містом старого розміру сектора (до збільшення карти) не підтримується: почни нову гру.');
    }
    return { ...f, version: 4, state: { ...f.state, sectors: f.state.sectors.map((s) => ({ ...s, trails: null, nodes: null })) } };
  },
  // v4 -> v5: ім'я/стати/перки NPC (масиви з'являються при завантаженні зі значеннями за замовчуванням) і workerCap будівель (необов'язкове).
  4: (old) => ({ ...(old as object), version: 5 }),
  // v5 -> v6: стат size у NPC (stride статів 4 -> 5; перевпорядкування робить deserialize).
  5: (old) => ({ ...(old as object), version: 6 }),
  // v6 -> v7: ОДНА суцільна карта 512×512 клітинок (2048² тайлів), безшовна генерація. Світ без міста переносимо.
  6: (old) => {
    const f = old as { version: number; state: { buildings: unknown[]; npcs: { count: number }; sectors: object[] } & Record<string, unknown> };
    if (f.state.buildings.length > 0 || f.state.npcs.count > 0) {
      throw new Error('Сейв із містом на карті старого розміру не підтримується: почни нову гру.');
    }
    return { ...f, version: 7, state: { ...f.state, sectors: f.state.sectors.map((s) => ({ ...s, trails: null, nodes: null })) } };
  },
  // v7 -> v8: активна зона 700 + неактивна смуга 64 клітинки навколо (карта 828×828). Світ без міста переносимо (стежки/вузли скидаємо).
  7: (old) => {
    const f = old as { version: number; state: { buildings: unknown[]; npcs: { count: number }; sectors: object[] } & Record<string, unknown> };
    if (f.state.buildings.length > 0 || f.state.npcs.count > 0) {
      throw new Error('Сейв із містом на карті старого розміру не підтримується: почни нову гру.');
    }
    return { ...f, version: 8, state: { ...f.state, sectors: f.state.sectors.map((s) => ({ ...s, trails: null, nodes: null })) } };
  },
  // v8 -> v9: ситість NPC (fullness) і ферма/фермер; масив fullness створює deserialize (повна ситість).
  8: (old) => ({ ...(old as object), version: 9 }),
  // v9 -> v10: дика фауна (fauna); порожню створює wrapState, звірі з'являються самі.
  9: (old) => ({ ...(old as object), version: 10 }),
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
