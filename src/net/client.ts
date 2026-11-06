import {
  NET_PROTOCOL_VERSION,
  type ClientMessage, type HostMessage, type LobbyPlayer, type PlayerId, type SerializedGameState,
} from '../shared';
import type { ClientSideConn } from './types';

export type JoinResult =
  | { ok: true; player: PlayerId; token: string; snapshot: SerializedGameState }
  | { ok: false; reason: Extract<HostMessage, { t: 'join_rejected' }>['reason'] | 'connection_lost' };

const TOKEN_KEY = (code: string) => `balagannuku.token.${code}`;
export const loadToken = (code: string): string | null => {
  try { return localStorage.getItem(TOKEN_KEY(code)); } catch { return null; }
};
const saveToken = (code: string, t: string) => { try { localStorage.setItem(TOKEN_KEY(code), t); } catch { /* ignore */ } };

/** Клієнтська сторона: join -> lobby-оновлення -> welcome. */
export class ClientLobby {
  onLobby: (players: LobbyPlayer[]) => void = () => {};
  onMessage: (msg: HostMessage) => void = () => {};
  onLost: () => void = () => {};
  private done: ((r: JoinResult) => void) | null = null;

  constructor(private conn: ClientSideConn) {}

  join(roomCode: string, nickname: string): Promise<JoinResult> {
    return new Promise((resolve) => {
      this.done = resolve;
      this.conn.onMessage((msg) => this.handle(roomCode, msg));
      this.conn.onClose(() => { this.finish({ ok: false, reason: 'connection_lost' }); this.onLost(); });
      this.conn.send({ t: 'join', protocol: NET_PROTOCOL_VERSION, nickname, token: loadToken(roomCode), roomCode });
    });
  }

  send(msg: ClientMessage): void { this.conn.send(msg); }
  close(): void { this.conn.close(); }

  private finish(r: JoinResult): void { const d = this.done; this.done = null; d?.(r); }

  private handle(code: string, msg: HostMessage): void {
    if (msg.t === 'welcome') {
      saveToken(code, msg.token);
      this.finish({ ok: true, player: msg.player, token: msg.token, snapshot: msg.snapshot });
    } else if (msg.t === 'join_rejected') this.finish({ ok: false, reason: msg.reason });
    else if (msg.t === 'lobby') this.onLobby(msg.players);
    else this.onMessage(msg);
  }
}
