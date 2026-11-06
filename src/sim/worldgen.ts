import type { GameState, PlayerState, ResourceKind, SectorState } from '../shared';
import { MIN_START_DISTANCE, createFlowLedger } from '../shared';
import { fbm } from './noise';
import { hexDisc, hexDistance } from './hex';

/** Які ресурси несе сектор (з шуму) і з якими солями/масштабами. */
export const SECTOR_RESOURCES: readonly { kind: ResourceKind; salt: number; scale: number }[] = [
  { kind: 'wood', salt: 11, scale: 0.35 },
  { kind: 'stone', salt: 23, scale: 0.4 },
  { kind: 'ore', salt: 37, scale: 0.5 },
  { kind: 'water', salt: 51, scale: 0.3 },
  { kind: 'food', salt: 67, scale: 0.35 },
  { kind: 'gold', salt: 79, scale: 0.6 },
];

export const DEFAULT_WORLD_RADIUS = 12;

/** Генерація секторів: richness 0..1 з фрактального шуму; золото рідкісне (підсилена крива). */
export function generateSectors(seed: number, radius: number): SectorState[] {
  return hexDisc(radius).map((hex, id) => {
    const richness: Partial<Record<ResourceKind, number>> = {};
    for (const { kind, salt, scale } of SECTOR_RESOURCES) {
      let v = fbm(hex.q * scale + (seed % 997), hex.r * scale + ((seed >> 10) % 991), salt);
      if (kind === 'gold' || kind === 'ore') v = Math.pow(v, 2.2) * 1.6;
      richness[kind] = Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
    }
    return { id, hex, owner: null, richness, trails: null, nodes: null };
  });
}

export function createInitialState(
  seed: number,
  radius = DEFAULT_WORLD_RADIUS,
  minStartDistance = MIN_START_DISTANCE,
  players: PlayerState[] = [],
): Omit<GameState, 'npcs'> {
  return {
    tick: 0,
    rngState: seed >>> 0,
    world: { seed, radius, minStartDistance },
    players,
    sectors: generateSectors(seed, radius),
    buildings: [],
    nextBuildingId: 1,
    flows: createFlowLedger(),
  };
}

export type ClaimResult = { ok: true } | { ok: false; reason: 'invalid' | 'occupied' | 'too_close_to_start' };

/** Перевірка вибору стартового сектора: вільний і не ближче minStartDistance до чужих стартів. */
export function canClaimStart(
  state: Pick<GameState, 'sectors' | 'players' | 'world'>,
  playerId: string,
  sectorId: number,
): ClaimResult {
  const sector = state.sectors[sectorId];
  const player = state.players.find((p) => p.id === playerId);
  if (!sector || !player || player.homeSector !== null) return { ok: false, reason: 'invalid' };
  if (sector.owner !== null) return { ok: false, reason: 'occupied' };
  for (const p of state.players) {
    if (p.id === playerId || p.homeSector === null) continue;
    if (hexDistance(sector.hex, state.sectors[p.homeSector].hex) < state.world.minStartDistance) {
      return { ok: false, reason: 'too_close_to_start' };
    }
  }
  return { ok: true };
}

/** Застосувати вибір старту (мутує state; викликати лише після canClaimStart). */
export function claimStart(state: Pick<GameState, 'sectors' | 'players' | 'world'>, playerId: string, sectorId: number): ClaimResult {
  const res = canClaimStart(state, playerId, sectorId);
  if (!res.ok) return res;
  const player = state.players.find((p) => p.id === playerId)!;
  player.homeSector = sectorId;
  player.ownedSectors.push(sectorId);
  state.sectors[sectorId].owner = playerId;
  return res;
}
