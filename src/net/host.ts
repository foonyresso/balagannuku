import {
  MAX_PLAYERS, NET_PROTOCOL_VERSION,
  type ClientMessage, type HostMessage, type LobbyPlayer, type PlayerId, type PlayerState, type SerializedGameState,
} from '../shared';
import type { HostSideConn } from './types';

interface Slot {
  id: PlayerId;
  nickname: string;
  token: string;
  conn: HostSideConn | null;
  isHost: boolean;
}

const newToken = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');

/** Хост-авторитетне лобі: приймає join, видає id/токени, розсилає список гравців. */
export class HostLobby {
  private slots: Slot[] = [];
  private snapshot: SerializedGameState | null = null;
  onChange: (players: LobbyPlayer[]) => void = () => {};
  onMessage: (player: PlayerId, msg: ClientMessage) => void = () => {};

  constructor(readonly roomCode: string, hostNickname: string) {
    this.slots.push({ id: 'p1', nickname: hostNickname, token: newToken(), conn: null, isHost: true });
  }

  /** «Продовжити»: слоти з гравців сейва (перший — хост); повернення — за токеном. */
  static fromPlayers(roomCode: string, players: Pick<PlayerState, 'id' | 'nickname' | 'token'>[]): HostLobby {
    const lobby = new HostLobby(roomCode, players[0].nickname);
    lobby.slots = players.map((p, i) => ({ id: p.id, nickname: p.nickname, token: p.token, conn: null, isHost: i === 0 }));
    return lobby;
  }

  get hostPlayer(): PlayerId { return this.slots[0].id; }

  players(): LobbyPlayer[] {
    return this.slots.map((s) => ({ id: s.id, nickname: s.nickname, online: s.isHost || s.conn !== null, isHost: s.isHost }));
  }

  /** Нове вхідне з'єднання; перше повідомлення має бути join. */
  accept(conn: HostSideConn): void {
    let slot: Slot | null = null;
    conn.onMessage((msg) => {
      if (!slot) {
        if (msg.t !== 'join') return;
        slot = this.handleJoin(conn, msg);
        return;
      }
      if (msg.t === 'ping') conn.send({ t: 'pong', ts: msg.ts });
      else this.onMessage(slot.id, msg);
    });
    conn.onClose(() => {
      if (slot && slot.conn === conn) { slot.conn = null; this.broadcastLobby(); }
    });
  }

  private reject(conn: HostSideConn, reason: Extract<HostMessage, { t: 'join_rejected' }>['reason']): null {
    conn.send({ t: 'join_rejected', reason });
    conn.close();
    return null;
  }

  private handleJoin(conn: HostSideConn, msg: Extract<ClientMessage, { t: 'join' }>): Slot | null {
    if (msg.protocol !== NET_PROTOCOL_VERSION) return this.reject(conn, 'protocol_mismatch');
    if (msg.roomCode !== this.roomCode) return this.reject(conn, 'bad_code');
    let slot: Slot | undefined;
    if (msg.token) {
      slot = this.slots.find((s) => s.token === msg.token);
      if (slot?.conn) return this.reject(conn, 'token_conflict');
    }
    if (!slot) {
      if (this.slots.length >= MAX_PLAYERS) return this.reject(conn, 'room_full');
      slot = { id: `p${this.slots.length + 1}`, nickname: msg.nickname, token: newToken(), conn: null, isHost: false };
      this.slots.push(slot);
    }
    slot.conn = conn;
    this.broadcastLobby();
    this.sendWelcome(slot);
    return slot;
  }

  private sendWelcome(slot: Slot): void {
    if (this.snapshot && slot.conn) slot.conn.send({ t: 'welcome', player: slot.id, token: slot.token, snapshot: this.snapshot });
  }

  /** Гра стартувала: надсилає welcome усім підключеним; пізні гравці отримають його одразу. */
  startGame(snapshot: SerializedGameState): void {
    this.snapshot = snapshot;
    this.slots.forEach((s) => this.sendWelcome(s));
  }

  send(player: PlayerId, msg: HostMessage): void { this.slots.find((s) => s.id === player)?.conn?.send(msg); }

  broadcast(msg: HostMessage): void { this.slots.forEach((s) => s.conn?.send(msg)); }

  private broadcastLobby(): void {
    const players = this.players();
    this.broadcast({ t: 'lobby', players, unclaimed: [] });
    this.onChange(players);
  }

  close(): void { this.slots.forEach((s) => s.conn?.close()); }
}
