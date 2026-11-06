import type { CommandRejectReason, GameState, HostMessage, PlayerId, PlayerState, SectorId, SerializedGameState } from '../shared';
import { RESOURCE_KINDS } from '../shared';
import { canClaimStart, claimStart } from '../sim/worldgen';
import type { ClientLobby } from './client';
import type { HostLobby } from './host';

/** Частина GameState, яку поки синхронізуємо й малюємо. */
export type MapState = Pick<GameState, 'sectors' | 'players' | 'world'> & Partial<GameState>;

const COLORS = [0x4fc3f7, 0xff7043, 0x9ccc65, 0xba68c8, 0xffd54f, 0x4db6ac];

export const mkPlayer = (id: string, nickname: string, index: number): PlayerState => ({
  id, nickname, token: id, color: COLORS[index % COLORS.length], homeSector: null, ownedSectors: [],
  resources: Object.fromEntries(RESOURCE_KINDS.map((k) => [k, 0])) as PlayerState['resources'],
});

/** Хост -> мережа: знімок світу (NPC поки порожні). */
/** Знімок компактний: великі масиви сектора (стежки, вузли) гість не отримує — вузли виводяться з seed. */
const toSnapshot = (s: MapState): SerializedGameState =>
  ({
    ...s,
    sectors: s.sectors.map((x) => ({ ...x, trails: null, nodes: null })),
    npcs: { capacity: 0, count: 0 },
  }) as unknown as SerializedGameState;

/** Хост: тримає авторитетний стан, приймає команди клієнтів, розсилає події. */
export class HostSession {
  onChange: () => void = () => {};
  /** Поточна швидкість гри (0 = пауза); нові/перепідключені гравці отримують її при зміні лобі. */
  speed = 1;

  constructor(private lobby: HostLobby, readonly state: MapState) {
    this.syncPlayers();
    lobby.onChange = () => { this.syncPlayers(); this.lobby.broadcast({ t: 'speed', speed: this.speed }); this.onChange(); };
    lobby.onMessage = (player, msg) => {
      if (msg.t !== 'command') return;
      const cmd = msg.cmd;
      if (cmd.type !== 'claim_start_sector') {
        lobby.send(player, { t: 'command_result', result: { seq: msg.seq, ok: false, reason: 'invalid' } });
        return;
      }
      const r = this.claim(player, cmd.sector);
      lobby.send(player, { t: 'command_result', result: r.ok ? { seq: msg.seq, ok: true } : { seq: msg.seq, ok: false, reason: r.reason as CommandRejectReason } });
    };
    lobby.startGame(() => toSnapshot(this.state));
  }

  /** Гравці лобі, яких ще нема в стані (пізні підключення), додаються до гри. */
  private syncPlayers(): void {
    for (const lp of this.lobby.players()) {
      if (!this.state.players.some((p) => p.id === lp.id)) {
        this.state.players.push(mkPlayer(lp.id, lp.nickname, this.state.players.length));
      }
    }
  }

  setSpeed(speed: number): void {
    this.speed = speed;
    this.lobby.broadcast({ t: 'speed', speed });
  }

  /** Вибір старту (і для самого хоста): валідація, застосування, розсилка всім. */
  claim(player: PlayerId, sector: SectorId) {
    const r = claimStart(this.state, player, sector);
    if (r.ok) this.lobby.broadcast({ t: 'events', tick: this.state.tick ?? 0, events: [{ e: 'sector_claimed', sector, player }] });
    return r;
  }
}

/** Клієнт: стан зі знімка хоста, зміни — тільки подіями хоста. */
export class ClientSession {
  readonly state: MapState;
  onChange: () => void = () => {};
  onResult: (ok: boolean, reason?: CommandRejectReason) => void = () => {};
  /** Хост змінив швидкість гри. */
  onSpeed: (speed: number) => void = () => {};
  private seq = 0;

  constructor(private client: ClientLobby, snapshot: SerializedGameState, readonly me: PlayerId) {
    this.state = snapshot as unknown as MapState;
    client.onMessage = (m) => this.handle(m);
    client.onLobby = () => {};
  }

  claim(sector: SectorId): void {
    this.client.send({ t: 'command', seq: ++this.seq, cmd: { type: 'claim_start_sector', sector } });
  }

  canClaim(sector: SectorId) { return canClaimStart(this.state, this.me, sector); }

  private handle(m: HostMessage): void {
    if (m.t === 'events') {
      for (const ev of m.events) {
        if (ev.e === 'sector_claimed') claimStart(this.state, ev.player, ev.sector);
      }
      this.onChange();
    } else if (m.t === 'snapshot') {
      Object.assign(this.state, m.state);
      this.onChange();
    } else if (m.t === 'speed') this.onSpeed(m.speed);
    else if (m.t === 'command_result') this.onResult(m.result.ok, m.result.reason);
  }
}
