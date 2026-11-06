import type { BuildingId, BuildingKind, CellCoord, NpcId, PlayerId, Profession, SectorId } from './ids';

/**
 * Команди — ЄДИНИЙ спосіб змінити стан гри. Клієнт шле Command хосту,
 * хост валідує (власник, ресурси, зайнятість) і застосовує на тіку.
 */
export type Command =
  | { type: 'claim_start_sector'; sector: SectorId }
  | { type: 'buy_sector'; sector: SectorId }
  | { type: 'place_building'; kind: BuildingKind; sector: SectorId; cell: CellCoord }
  | { type: 'demolish_building'; building: BuildingId }
  | { type: 'assign_worker'; npc: NpcId; profession: Profession; building: BuildingId | null }
  | { type: 'unassign_worker'; npc: NpcId }
  | { type: 'transfer_item'; from: NpcId; to: NpcId; slot: number }
  | { type: 'equip_item'; npc: NpcId; slot: number; equipSlot: number }
  | { type: 'set_trail_overlay_hint'; sector: SectorId }; // тільки UI-підказка, стан не змінює

/** Команда з метаданими; `seq` — лічильник клієнта для відповідей про відмову. */
export interface CommandEnvelope {
  player: PlayerId;
  seq: number;
  cmd: Command;
}

export type CommandRejectReason =
  | 'not_owner' | 'no_resources' | 'occupied' | 'too_close_to_start' | 'invalid' | 'not_host_tick';

export interface CommandResult {
  seq: number;
  ok: boolean;
  reason?: CommandRejectReason;
}
