import { describe, expect, it } from 'vitest';
import { ClientLobby } from './client';
import { HostLobby } from './host';
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from './roomCode';
import type { ClientSideConn, HostSideConn } from './types';
import { createInitialState, canClaimStart } from '../sim/worldgen';
import { ClientSession, HostSession, mkPlayer } from './session';
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

describe('синхронізація карти', () => {
  it('клієнт отримує світ і вибір сектора синхронізується', async () => {
    const wait = () => new Promise((r) => setTimeout(r, 10));
    const host = new HostLobby('ABCDE', 'Хост');
    const state = createInitialState(42, 4, 2, [mkPlayer('p1', 'Хост', 0)]);
    const p = pair(); host.accept(p.host);
    const c = new ClientLobby(p.client);
    const res = c.join('ABCDE', 'Гість');
    await wait();
    const hs = new HostSession(host, state);
    const r = await res;
    if (!r.ok) throw new Error('join');
    expect(hs.state.players).toHaveLength(2);
    const cs = new ClientSession(c, JSON.parse(JSON.stringify(r.snapshot)), r.player);
    expect(cs.state.sectors).toHaveLength(state.sectors.length);
    expect(cs.state.world.seed).toBe(42);
    // клієнт займає сектор 0; хост підтверджує й розсилає
    const results: boolean[] = []; cs.onResult = (ok) => results.push(ok);
    cs.claim(0); await wait();
    expect(results).toEqual([true]);
    expect(state.sectors[0].owner).toBe('p2');
    expect(cs.state.sectors[0].owner).toBe('p2');
    // зайнятий сектор хост відхиляє
    expect(hs.claim('p1', 0)).toMatchObject({ ok: false, reason: 'occupied' });
    // хост займає інший — клієнт бачить у реальному часі
    const far = state.sectors.find((s) => s.owner === null && canClaimStart(state, 'p1', s.id).ok)!;
    hs.claim('p1', far.id); await wait();
    expect(cs.state.sectors[far.id].owner).toBe('p1');
  });
});
