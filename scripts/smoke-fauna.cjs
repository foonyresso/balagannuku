// Headless: звірі в місті — є спрайти, мисливець полює й дає їжу, консоль без помилок. Потрібен vite preview на :4173.
const { chromium } = require('playwright');
let fails = 0;
const check = (name, ok, extra = '') => { console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : extra); if (!ok) fails++; };
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 800, height: 500 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/net::|Failed to load resource|ERR_/i.test(m.text())) errs.push(m.text()); });
  await p.goto(process.env.URL || 'http://localhost:4173');
  await p.waitForSelector('.lb button'); await p.evaluate(() => document.querySelector('.lb').remove());
  await p.waitForTimeout(500);
  for (const [dx, dy] of [[0,0],[300,0],[-300,0],[0,200],[0,-200],[300,200],[-300,-200]]) {
    await p.mouse.move(400 + dx / 2, 250 + dy / 2); await p.mouse.down(); await p.mouse.up();
    if (!(await p.isDisabled('#play'))) break;
  }
  await p.click('#play'); await p.waitForSelector('#cityHud'); await p.waitForTimeout(1500);
  const placed = await p.evaluate(() => {
    const c = window.__city, th = c.w.state.buildings.find((x) => x.kind === 'townhall');
    for (const pl of c.w.state.players) for (const k of Object.keys(pl.resources)) pl.resources[k] = 9999;
    for (let i = 0; i < 400; i++) {
      const cell = { x: th.cell.x - 60 + (i % 20) * 12, y: th.cell.y - 40 + Math.floor(i / 20) * 12 };
      if (c.cmd({ type: 'place_building', kind: 'hunter', sector: c.sector, cell }).ok) return true;
    }
    return false;
  });
  check('мисливця поставлено', placed);
  await p.keyboard.press('Escape');
  await p.click('[data-speed="10"]').catch(() => {});
  await p.waitForTimeout(25000);
  const r = await p.evaluate(() => {
    const c = window.__city, w = c.w, f = w.state.flows.total, h = w.state.buildings.find((x) => x.kind === 'hunter');
    const kinds = {}; for (const a of w.state.fauna.animals) kinds[a.kind] = (kinds[a.kind] || 0) + 1;
    return { sprites: c.debugState().animals, animals: w.state.fauna.animals.length, kinds, tick: w.state.tick, workers: h.workers.length, why: String(w.why.get(h.id)), food: f.byBuilding[h.id]?.produced.food ?? 0, wood: f.byBuilding[h.id]?.produced.wood ?? 0 };
  });
  console.log(JSON.stringify(r));
  check('звірі є в стані', r.animals > 20, String(r.animals));
  check('усі шість видів', Object.keys(r.kinds).length === 6, JSON.stringify(r.kinds));
  check('звірі мають спрайти', r.sprites === r.animals, `${r.sprites}/${r.animals}`);
  check('мисливець добув мʼясо', r.food > 0, String(r.food));
  check('мисливець не рубає дерево', r.wood === 0, String(r.wood));
  check('консоль без помилок', errs.length === 0, errs.join(' | '));
  await b.close(); process.exit(fails ? 1 : 0);
})();
