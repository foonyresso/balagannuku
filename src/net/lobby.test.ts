import { describe, expect, it } from 'vitest';
import { ClientLobby } from './client';
import { HostLobby } from './host';
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from './roomCode';
import type { ClientSideConn, HostSideConn } from './types';
import type { ClientMessage, HostMessage, SerializedGameState } from '../shared';

function pair(): { host: HostSideConn; client: ClientSideConn } {
  let hm: (m: ClientMessage) => void = () => {}, cm: (m: HostMessage) => void = () => {};
  let hc = () => {}, cc = () => {};
  const q = (f: () => void) => queueMicrotask(f);
  return {
    host: { send: (m) => q(() => cm(m)), onMessage: (cb) => { hm = cb; }, onClose: (cb) => { hc = cb; }, close: () => q(cc) },
    client: { send: (m) => q(() => hm(m)), onMessage: (cb) => { cm = cb; }, onClose: (cb) => { cc = cb; }, close: () => q(hc) },
  };
}
const snap = {} as SerializedGameState;

describe('room code', () => {
  it('генерує валідний код', () => {
    expect(isValidRoomCode(generateRoomCode())).toBe(true);
    expect(normalizeRoomCode(' ab-cd5 ')).toBe('ABCD5');
  });
});

describe('lobby', () => {
  it('приймає гравця, віддає welcome після старту', async () => {
    const host = new HostLobby('ABCDE', 'Хост');
    const p = pair(); host.accept(p.host);
    const c = new ClientLobby(p.client);
    const res = c.join('ABCDE', 'Гість');
    await new Promise((r) => setTimeout(r, 5));
    expect(host.players()).toHaveLength(2);
    host.startGame(snap);
    const r = await res;
    expect(r.ok && r.player).toBe('p2');
  });
  it('відхиляє невірний код і переповнення', async () => {
    const host = new HostLobby('ABCDE', 'Хост');
    const p = pair(); host.accept(p.host);
    const r = await new ClientLobby(p.client).join('ZZZZZ', 'x');
    expect(r).toEqual({ ok: false, reason: 'bad_code' });
  });
});
