// Headless: збереження. Нова гра -> місто -> автосейв/ручне збереження -> файл -> перезавантаження сторінки -> «Продовжити»
// -> завантаження з файлу в грі -> несумісний сейв. Мережу (PeerJS) мокаємо, потрібен dev/preview-сервер (URL).
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const fail = (m) => { console.log('FAIL:', m); process.exitCode = 1; };
const ok = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ acceptDownloads: true }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.addInitScript(() => { delete window.showSaveFilePicker; delete window.showOpenFilePicker; }); // форсуємо запасні шляхи
  await p.route(/peerjs/, (r) => r.request().url().includes('.js') ? r.fulfill({ contentType: 'text/javascript', body:
    'export default class Peer{constructor(){this.h={};setTimeout(()=>(this.h.open||[]).forEach(f=>f()),5)}on(e,f){(this.h[e]??=[]).push(f);return this}destroy(){}connect(){}}' }) : r.continue());
  const url = process.env.URL || 'http://localhost:4173';
  const game = (expr) => p.evaluate(`(() => { const g = window.__game; return ${expr}; })()`);
  const enterGame = async () => {
    await p.waitForSelector('#start'); await p.click('#start'); await p.waitForTimeout(800);
  };

  await p.goto(url); await p.waitForSelector('#new');
  await p.waitForTimeout(300);
  ok(!(await p.isVisible('#contAuto')), 'без автосейва кнопки «Продовжити» нема');
  await p.click('#new'); await enterGame();
  const vp = p.viewportSize();
  for (const [dx, dy] of [[0,0],[300,0],[-300,0],[0,200],[0,-200],[300,200],[-300,-200]]) {
    await p.mouse.move(vp.width / 2 + dx, vp.height / 2 + dy); await p.mouse.down(); await p.mouse.up();
    if (!(await p.isDisabled('#play'))) break;
  }
  await p.click('#play'); await p.waitForTimeout(1500);
  ok(!(await p.isVisible('#hud')), 'місто відкрито');
  ok(await p.isVisible('#saveToggle'), 'кнопка «Збереження» видима в місті');
  await p.click('[data-speed="5"]'); await p.waitForTimeout(3000);
  const t0 = await game('g.sim.state.tick'), n0 = await game('g.sim.state.buildings.length'), np0 = await game('g.sim.state.npcs.count');
  ok(t0 > 0 && n0 > 0, `тіки йдуть (${t0}), будівель ${n0}, NPC ${np0}`);

  await p.click('#saveToggle'); await p.click('#saveNow'); await p.waitForTimeout(3000);
  const st = await p.textContent('#saveSt');
  ok(/Збережено/.test(st), `статус після збереження: «${st}»`);
  const dl = p.waitForEvent('download'); await p.click('#saveFile'); const d = await dl;
  const file = path.join(os.tmpdir(), 'smoke.save'); await d.saveAs(file);
  ok(fs.statSync(file).size > 1000 && d.suggestedFilename().endsWith('.save'), `файл ${d.suggestedFilename()} ${fs.statSync(file).size} Б`);
  const tSaved = await game('g.ctl.last.tick');

  // перезавантаження сторінки -> «Продовжити»
  await p.reload(); await p.waitForSelector('#new'); await p.waitForTimeout(500);
  ok(await p.isVisible('#contAuto'), 'є кнопка «Продовжити»');
  await p.click('#contAuto'); await enterGame(); await p.waitForTimeout(1500);
  ok(!(await p.isVisible('#hud')), 'після «Продовжити» гра одразу в місті');
  ok((await game('g.sim.state.buildings.length')) === n0 && (await game('g.sim.state.npcs.count')) === np0, 'будівлі й NPC збігаються зі збереженими');
  ok((await game('g.sim.state.tick')) >= tSaved, 'тік не менший за збережений');
  ok((await game('g.speed')) === 5, 'швидкість 5× відновлено');
  await p.waitForTimeout(1500);
  ok((await game('g.sim.state.tick')) > tSaved, 'симуляція йде далі');

  // завантаження з файлу в грі
  await p.click('#saveToggle');
  const fc = p.waitForEvent('filechooser'); await p.click('#loadFile'); (await fc).setFiles(file);
  await p.waitForTimeout(3000);
  ok(!/FAIL|помил|Не вдалося/i.test(await p.textContent('#saveSt')) && (await game('g.sim.state.buildings.length')) === n0, 'завантаження з файлу в грі');
  ok(!(await p.isVisible('#hud')), 'після завантаження знову місто');

  // несумісний сейв в автозбереженні
  await p.evaluate(() => new Promise((res) => {
    const bad = new TextEncoder().encode(JSON.stringify({ magic: 'balagannuku-save', version: 3, state: { buildings: [1], npcs: { count: 1 }, sectors: [] } }));
    const r = indexedDB.open('balagannuku', 1); r.onsuccess = () => { const t = r.result.transaction('saves', 'readwrite'); const s = t.objectStore('saves'); s.put(bad, 'autosave'); s.put(bad, 'autosave-prev'); t.oncomplete = () => res(); };
  }));
  await p.reload(); await p.waitForSelector('#new'); await p.waitForTimeout(500);
  await p.click('#contAuto'); await p.waitForTimeout(1000);
  const e = await p.textContent('.lb #err');
  ok(/почни нову гру/.test(e), `несумісний сейв: «${e}»`);
  ok(errs.length === 0, 'консоль без помилок ' + (errs.length ? JSON.stringify(errs.slice(0, 5)) : ''));
  await b.close();
})().catch((e) => { fail(e.stack || e); process.exit(1); });
