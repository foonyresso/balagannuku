import Peer, { type DataConnection } from 'peerjs';
import type { ClientMessage, HostMessage } from '../shared';
import { generateRoomCode, peerIdForRoom } from './roomCode';
import type { ClientSideConn, Conn, HostSideConn } from './types';

function wrap<In, Out>(dc: DataConnection): Conn<In, Out> {
  return {
    send: (m) => { if (dc.open) dc.send(m); },
    onMessage: (cb) => { dc.on('data', (d) => cb(d as In)); },
    onClose: (cb) => { dc.on('close', cb); dc.on('error', cb); },
    close: () => dc.close(),
  };
}

/** Створює кімнату: реєструє peer з id за кодом (при колізії — новий код). */
export function openRoom(onConn: (c: HostSideConn) => void, attempts = 5): Promise<{ code: string; peer: Peer }> {
  return new Promise((resolve, reject) => {
    const tryOnce = (left: number) => {
      const code = generateRoomCode();
      const peer = new Peer(peerIdForRoom(code));
      peer.on('open', () => {
        peer.on('connection', (dc) => dc.on('open', () => onConn(wrap<ClientMessage, HostMessage>(dc))));
        resolve({ code, peer });
      });
      peer.on('error', (e: { type?: string }) => {
        peer.destroy();
        if (e.type === 'unavailable-id' && left > 1) tryOnce(left - 1);
        else reject(e);
      });
    };
    tryOnce(attempts);
  });
}

/** Підключення до кімнати за кодом. */
export function connectToRoom(code: string, timeoutMs = 10000): Promise<{ conn: ClientSideConn; peer: Peer }> {
  return new Promise((resolve, reject) => {
    const peer = new Peer();
    const fail = (e: unknown) => { peer.destroy(); reject(e); };
    const timer = setTimeout(() => fail(new Error('timeout')), timeoutMs);
    peer.on('error', (e) => { clearTimeout(timer); fail(e); });
    peer.on('open', () => {
      const dc = peer.connect(peerIdForRoom(code), { reliable: true, serialization: 'json' });
      dc.on('open', () => { clearTimeout(timer); resolve({ conn: wrap<HostMessage, ClientMessage>(dc), peer }); });
    });
  });
}
