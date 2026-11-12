import type { BuildingId, BuildingKind, CellCoord, NpcId, PlayerId, Profession, ResourceKind, SectorId, WallId } from './ids';
import type { MonsterKind, WallKind } from './defense';
import type { NpcClass } from './npc';

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
  | { type: 'set_worker_count'; building: BuildingId; count: number }
  | { type: 'set_building_paused'; building: BuildingId; paused: boolean }
  | { type: 'transfer_item'; from: NpcId; to: NpcId; slot: number }
  | { type: 'equip_item'; npc: NpcId; slot: number; equipSlot: number }
  | { type: 'set_trail_overlay_hint'; sector: SectorId } // тільки UI-підказка, стан не змінює
  // --- темний світ (контракти етапу 0; хост поки відхиляє з reason 'invalid', поведінка приходить зі своїми етапами) ---
  /** Протяжка стіни по прямій (горизонталь або вертикаль) від клітинки `from` до `to` (клітинки навігації). Ворота й вежа — одна клітинка / 2×2 у `from`. */
  | { type: 'place_wall'; kind: WallKind; sector: SectorId; from: CellCoord; to: CellCoord }
  /** Позначити зону розчищення (прямокутник у клітинках навігації, включно): дерева й каміння в ній знімаються назавжди. */
  | { type: 'mark_clear'; sector: SectorId; from: CellCoord; to: CellCoord; clear: boolean }
  | { type: 'upgrade_building'; building: BuildingId }
  /** Обрати рецепт станції (id у RECIPES) або рослину ділянки алхімічної ферми. */
  | { type: 'set_building_recipe'; building: BuildingId; recipe: number }
  /** Прийняти кандидата; з `work` одразу на роботу (як assign_worker). */
  | { type: 'accept_candidate'; npc: NpcId; work?: { profession: Profession; building: BuildingId | null } }
  | { type: 'dismiss_candidate'; npc: NpcId }
  /** Навчити вільного NPC лучником у споруді тренування (змінює клас). */
  | { type: 'train_archer'; building: BuildingId; npc: NpcId }
  /** Поставити лучника на слот вежі (npc = null звільняє слот). */
  | { type: 'assign_garrison'; tower: WallId; slot: number; npc: NpcId | null }
  /** Адмін-панель для тестів: лише хост із `adminEnabled`, інакше відмова 'not_admin'. */
  | { type: 'admin'; action: AdminAction };

/** Дії адмін-панелі (`docs/DESIGN-dark-world.md`, п. 2.11). Доступні й через `window.__game.admin`. */
export type AdminAction =
  | { kind: 'skip_day' }
  | { kind: 'start_night'; night: number }
  | { kind: 'set_speed'; speed: 1 | 2 | 5 | 20 }
  | { kind: 'give'; resource: ResourceKind; amount: number }
  | { kind: 'spawn_candidate'; perks: number; level: number; klass?: NpcClass }
  | { kind: 'spawn_monsters'; monster: MonsterKind; count: number }
  | { kind: 'spawn_portal' }
  | { kind: 'kill_monsters' }
  | { kind: 'set_npc_level'; npc: NpcId; level: number }
  | { kind: 'heal_feed_all' }
  | { kind: 'reveal_all'; on: boolean }
  | { kind: 'finish_foundations' };

/** Команда з метаданими; `seq` — лічильник клієнта для відповідей про відмову. */
export interface CommandEnvelope {
  player: PlayerId;
  seq: number;
  cmd: Command;
}

export type CommandRejectReason =
  | 'not_owner' | 'no_resources' | 'occupied' | 'too_close_to_start' | 'invalid' | 'not_host_tick' | 'not_admin';

export interface CommandResult {
  seq: number;
  ok: boolean;
  reason?: CommandRejectReason;
}
