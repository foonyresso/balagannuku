import type { BuildingKind } from '../shared';
import type { SimWorld } from '../sim';
import type { Sel } from './info';

/** Дії, які панель просить у міста (виконує render/city/actions.ts). */
export interface HudHooks {
  pickBuild(k: BuildingKind | null): void;
  select(sel: Sel, follow: boolean): void;
  deselect(): void;
  follow(on: boolean): void;
  back(): void;
  speed(s: number): void;
  pause(id: number): void;
  demolish(id: number): void;
  addWorker(building: number): void;
  removeWorker(building: number): void;
  assign(npc: number, building: number): void;
  unassign(npc: number): void;
}
export interface HudState {
  selected: Sel | null; build: BuildingKind | null; following: boolean;
  /** Цільова й фактична швидкість гри; locked — керує хост. */
  speed: number; actualSpeed: number; speedLocked: boolean;
}
/** Що бачить розділ (вікно) інтерфейсу. */
export interface SectionCtx {
  hooks: HudHooks; w: SimWorld; player: string; sector: number;
  /** Режим призначення: клік по картці жителя сажає його в цю споруду. */
  assign: { target: number | null };
  /** Відкрити інший розділ (id з реєстру). */
  open(id: string, tab?: string): void;
}
