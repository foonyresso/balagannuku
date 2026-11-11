import type { Command, CommandResult } from './commands';
import type { PlayerId, Tick } from './ids';
import type { SerializedGameState } from './state';

/**
 * Мережа: WebRTC P2P, хост-авторитетна модель. Сигналізація (PeerJS/Trystero) — деталь реалізації в src/net.
 * Хост тримає симуляцію; клієнти шлють команди й малюють те, що отримали.
 */
export const NET_PROTOCOL_VERSION = 1;
export const SNAPSHOT_INTERVAL_TICKS = 50; // повний знімок раз на ~5 с (разом із дельтами)
export const ROOM_CODE_LENGTH = 5;

/** Клієнт -> хост */
export type ClientMessage =
  | { t: 'join'; protocol: number; nickname: string; token: string | null; roomCode: string }
  | { t: 'command'; seq: number; cmd: Command }
  | { t: 'ack_snapshot'; tick: Tick }
  | { t: 'ping'; ts: number };

/** Хост -> клієнт */
export type HostMessage =
  | { t: 'welcome'; player: PlayerId; token: string; snapshot: SerializedGameState }
  | { t: 'join_rejected'; reason: 'bad_code' | 'room_full' | 'protocol_mismatch' | 'token_conflict' }
  | { t: 'lobby'; players: LobbyPlayer[]; unclaimed: PlayerId[] } // для ручного призначення при втраті токена
  | { t: 'command_result'; result: CommandResult }
  | { t: 'events'; tick: Tick; events: GameEvent[] } // події між знімками
  | { t: 'snapshot'; tick: Tick; state: SerializedGameState }
  | { t: 'npc_positions'; tick: Tick; /* спрощений потік для рендера; формат — packed f32 x,y + id */ data: string }
  | { t: 'speed'; speed: number } // швидкість гри: керує хост, клієнти лише застосовують
  | { t: 'pong'; ts: number };

export interface LobbyPlayer {
  id: PlayerId;
  nickname: string;
  online: boolean;
  isHost: boolean;
}

/** Дискретні події хоста (мало даних): */
export type GameEvent =
  | { e: 'sector_claimed'; sector: number; player: PlayerId }
  | { e: 'building_placed'; building: number }
  | { e: 'building_removed'; building: number }
  | { e: 'tree_felled'; sector: number; cell: number; fx: number; fy: number } // fx,fy — тайл лісоруба: дерево падає від нього
  | { e: 'trail_stage_changed'; sector: number; cells: number[]; stage: number }
  | { e: 'player_joined' | 'player_left'; player: PlayerId };
