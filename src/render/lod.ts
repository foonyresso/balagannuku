/**
 * Рівні деталізації (LOD) від зуму камери міста. Усі пороги — тут: чим далі камера, тим менше анімацій і деталей.
 * Зум міста: 0.08 (весь сектор) … 10 (упритул до жителя). Прапор вмикається при `zoom >= поріг` (з гістерезисом, щоб не мерехтіло).
 */
export const LOD_CONFIG = {
  /** Колихання дерев і трави (найдрібніші анімації — зникають першими). */
  sway: 0.9,
  /** Пучки трави, що колишуться (шар над землею). */
  grass: 0.9,
  /** Частинки (тріски, іскри, пил, дим) і світляки. */
  particles: 0.6,
  /** Покадрова анімація жителів (ноги, удари інструмента, ноша). Нижче — один статичний кадр. */
  npcFrames: 0.4,
  /** Нижче — жителі як кольорові точки без текстур. */
  npcSprite: 0.2,
  /** Світіння вогнів. */
  lights: 0.25,
  /** Нижче — дерева малюються спрощеним спрайтом, споруди без диму/вогнів. */
  propsDetail: 0.2,
  /** Гістерезис: вмикається при zoom ≥ поріг·(1+h), вимикається при zoom < поріг. */
  hysteresis: 0.06,
  /** Стеля кількості одночасно колихаємих дерев і пучків трави (захист від просідань). */
  maxSway: 700,
  maxGrass: 260,
  /** Розмір точки жителя на екрані, пікселів. */
  dotPx: 2.6,
  /** Амплітуда колихання (радіани нахилу) для дерев і трави. */
  treeSwayAmp: 0.035,
  grassSwayAmp: 0.22,
} as const;

export type LodKey = 'sway' | 'grass' | 'particles' | 'npcFrames' | 'npcSprite' | 'lights' | 'propsDetail';
export type LodFlags = Record<LodKey, boolean>;
const KEYS: LodKey[] = ['sway', 'grass', 'particles', 'npcFrames', 'npcSprite', 'lights', 'propsDetail'];

/** Чиста функція без гістерезису (для тестів і початкового стану). */
export function lodFlags(zoom: number, cfg: Record<LodKey, number> = LOD_CONFIG): LodFlags {
  const f = {} as LodFlags;
  for (const k of KEYS) f[k] = zoom >= cfg[k];
  return f;
}

/** Поточний стан LOD із гістерезисом. */
export class Lod {
  flags: LodFlags;
  constructor(zoom: number, private cfg: Record<LodKey, number> & { hysteresis: number } = LOD_CONFIG) { this.flags = lodFlags(zoom, cfg); }
  /** Оновлює прапори; повертає true, якщо хоч один змінився. */
  update(zoom: number): boolean {
    let changed = false;
    for (const k of KEYS) {
      const on = this.flags[k], th = this.cfg[k];
      const next = on ? zoom >= th : zoom >= th * (1 + this.cfg.hysteresis);
      if (next !== on) { this.flags[k] = next; changed = true; }
    }
    return changed;
  }
}
