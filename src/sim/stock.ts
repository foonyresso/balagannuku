import type { BuildingState, ResourceKind } from '../shared';
import { MILL_BUFFER, STORAGE_CAP } from './balance';

/** Запаси споруд: що вважається сховищем і скільки чого воно вміщує. */

export const isStorage = (b: BuildingState): boolean => b.kind === 'townhall' || b.kind === 'warehouse';
export const stockOf = (b: BuildingState, k: ResourceKind): number => b.stock[k] ?? 0;

/** Місткість споруди для ресурсу: сховище — STORAGE_CAP, лісопильня — буфер колод, решта нічого не приймає. */
export const capOf = (b: BuildingState, k: ResourceKind): number =>
  isStorage(b) ? (STORAGE_CAP[b.kind] ?? 0) : b.kind === 'sawmill' && k === 'wood' ? MILL_BUFFER : 0;
