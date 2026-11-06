import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { RESOURCE_KINDS, SAVE_VERSION, SECTOR_SIZE, type PlayerState } from '../shared';
import { HostLobby } from '../net';
import { applyCommand, checkPlace, createWorld, serialize, startCity, staffBuilding, stepWorld, type SimWorld } from '../sim';
import { claimStart } from '../sim/worldgen';
import { COMPACT_NODEGEN, configureNodegen } from '../sim/nodegen';
import { AUTOSAVE_INTERVAL_MS, SaveController, SaveError, autosave, autosaveInfo, createSave, decodeSave, encodeSave, loadAutosave, loadGame, loadState, takeLoaded } from './index';

const mkp = (id: string): PlayerState => ({
  id, nickname: id, token: 't' + id, color: 1, homeSector: null, ownedSectors: [],
  resources: Object.fromEntries(RESOURCE_KINDS.map((k) => [k, 0])) as PlayerState['resources'],
});

/** Світ із містом: ратуша, лісоруб із працівником, трохи тіків (стежки, потоки, залишки вузлів). */
function mkWorld(seed = 7): SimWorld {
  configureNodegen(COMPACT_NODEGEN);
  const w = createWorld(seed, [mkp('p')]);
  expect(claimStart(w.state, 'p', 0).ok).toBe(true);
  startCity(w, 'p');
  const c = SECTOR_SIZE / 2;
  let best: { x: number; y: number } | null = null, bd = Infinity;
  for (let y = c - 120; y < c + 120; y += 2) for (let x = c - 120; x < c + 120; x += 2) {
    const d = Math.abs(x - c - 40) + Math.abs(y - c);
    if (d < bd && checkPlace(w, 0, 'lumberjack', x, y) === null) { bd = d; best = { x, y }; }
  }
  const r = applyCommand(w, { player: 'p', seq: 1, cmd: { type: 'place_building', kind: 'lumberjack', sector: 0, cell: best! } });
  expect(r.ok).toBe(true);
  staffBuilding(w, 'p', w.state.buildings[w.state.buildings.length - 1].id);
  for (let i = 0; i < 300; i++) stepWorld(w);
  return w;
}

const text = (e: unknown) => (e instanceof Error ? e.message : String(e));

describe('сейв', () => {
  const w = mkWorld();

  it('round-trip: збережене = завантажене (gzip і без), разом зі швидкістю', async () => {
    for (const gz of [true, false]) {
      const g = loadGame(await decodeSave(await encodeSave(createSave(w, { speed: 4 }), gz)));
      expect(g.speed).toBe(4);
      expect(JSON.stringify(serialize(g.world))).toBe(JSON.stringify(serialize(w)));
      expect(g.world.state.tick).toBe(w.state.tick);
      expect(g.world.state.npcs.x).toBeInstanceOf(Float32Array);
      const nid = w.state.npcs.alive.findIndex((a) => a === 1);
      expect(g.world.state.npcs.nameId[nid]).toBe(w.state.npcs.nameId[nid]);
      expect([...g.world.state.npcs.stats]).toEqual([...w.state.npcs.stats]);
      expect(g.world.state.flows).toEqual(w.state.flows);
    }
  });

  it('після завантаження гра йде далі без помилок, працівники на місцях', async () => {
    const g = loadGame(await decodeSave(await encodeSave(createSave(w))));
    const jobs = g.world.state.buildings.flatMap((b) => b.workers);
    expect(jobs.length).toBeGreaterThan(0);
    for (const id of jobs) expect(g.world.npc.workplace[id]).toBeGreaterThanOrEqual(0);
    const t = g.world.state.tick;
    for (let i = 0; i < 100; i++) stepWorld(g.world);
    expect(g.world.state.tick).toBe(t + 100);
  });

  it('старий сейв без швидкості йде на 1×; loadState/takeLoaded для лобі', async () => {
    const save = await decodeSave(await encodeSave(createSave(w, { speed: 2 })));
    delete save.speed;
    expect(loadGame(save).speed).toBe(1);
    const st = loadState(save);
    expect(takeLoaded(st)?.world.state).toBe(st);
  });

  it('несумісні сейви: чесні повідомлення', async () => {
    const base = JSON.parse(JSON.stringify(createSave(mkWorld(3)))) as { version: number };
    const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
    const fail = async (v: number) => { try { await decodeSave(enc({ ...base, version: v })); return ''; } catch (e) { expect(e).toBeInstanceOf(SaveError); return text(e); } };
    expect(await fail(SAVE_VERSION + 1)).toContain('новішою');
    expect(await fail(0)).toContain('почни нову гру');
    expect(await fail(2)).toContain('почни нову гру'); // з містом старого формату
    expect(await fail(7)).toContain('почни нову гру');
  });

  it('відхиляє сміття і недописаний сейв', async () => {
    await expect(decodeSave(new TextEncoder().encode('hello'))).rejects.toThrow(SaveError);
    await expect(decodeSave(new TextEncoder().encode('{"magic":"x"}'))).rejects.toThrow('не сейв');
    await expect(decodeSave(new TextEncoder().encode(`{"magic":"balagannuku-save","version":${SAVE_VERSION}}`))).rejects.toThrow('пошкоджений');
    await expect(decodeSave(new Uint8Array([0x1f, 0x8b, 1, 2, 3]))).rejects.toThrow(SaveError);
  });

  it('IndexedDB: автосейв, інфо, попередня копія як запасна', async () => {
    expect(await loadAutosave()).toBeNull();
    const r1 = await autosave(w, 2);
    expect(r1.ok).toBe(true);
    const info = await autosaveInfo();
    expect(info?.tick).toBe(w.state.tick);
    const back = await loadAutosave();
    expect(back?.speed).toBe(2);
    expect(JSON.stringify(loadGame(back!).world.state.players)).toBe(JSON.stringify(w.state.players));
    // другий запис; ушкоджуємо основний — лишається попередній
    for (let i = 0; i < 10; i++) stepWorld(w);
    await autosave(w, 1);
    const db = await new Promise<IDBDatabase>((res) => { const r = indexedDB.open('balagannuku', 1); r.onsuccess = () => res(r.result); });
    await new Promise<void>((res) => { const t = db.transaction('saves', 'readwrite'); t.objectStore('saves').put(new Uint8Array([1, 2, 3]), 'autosave'); t.oncomplete = () => res(); });
    db.close();
    const prev = await loadAutosave();
    expect(prev?.speed).toBe(2);
    expect(prev!.state.tick).toBe(info!.tick);
  });

  it('контролер: автосейв пропускає без змін, гість не зберігає, помилки в статусі', async () => {
    let canSave = true;
    const ctl = new SaveController({ world: () => w, speed: () => 1, canSave: () => canSave }, AUTOSAVE_INTERVAL_MS);
    const msgs: string[] = [];
    ctl.onStatus = (s) => msgs.push((s.error ? '!' : '') + s.text);
    expect(await ctl.saveNow()).toBe(true);
    expect(await ctl.auto().then(() => false)).toBe(false); // той самий тік
    stepWorld(w);
    await ctl.auto();
    expect(msgs.length).toBe(2);
    canSave = false;
    expect(await ctl.saveNow()).toBe(false);
    expect(msgs[msgs.length - 1]).toMatch(/^!.*хост/);
  });

  it('токени гравців зберігаються у слотах лобі', () => {
    const l = HostLobby.fromPlayers('ABCDE', [mkp('p1'), mkp('p2')]);
    expect(l.players().map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(l.players()[1].online).toBe(false);
  });
});
