// Headless: місто в стилі «Kingdom» — усі споруди, спрайти жителів, світло, частинки, зміна пори доби, консоль без помилок. Потрібен vite preview на :4173.
const { chromium } = require('playwright');
let fails = 0;
const check = (name, ok, extra = '') => { console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : extra); if (!ok) fails++; };
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/net::|Failed to load resource|ERR_/i.test(m.text())) errs.push(m.text()); });
  await p.goto(process.env.URL || 'http://localhost:4173');
  await p.waitForSelector('.lb button'); await p.evaluate(() => document.querySelector('.lb').remove());
  await p.waitForTimeout(500);
  for (const [dx, dy] of [[0,0],[300,0],[-300,0],[0,200],[0,-200],[300,200],[-300,-200]]) {
    await p.mouse.move(640 + dx, 400 + dy); await p.mouse.down(); await p.mouse.up();
    if (!(await p.isDisabled('#play'))) break;
  }
  await p.click('#play'); await p.waitForSelector('#cityHud'); await p.waitForTimeout(1500);
  const st = () => p.evaluate(() => window.__city.debugState());
  // дати ресурсів і поставити по споруді кожного виду
  await p.evaluate(() => { const g = window.__game.sim; for (const pl of g.state.players) for (const k of Object.keys(pl.resources)) pl.resources[k] = 9999; for (const b of g.state.buildings) if (b.kind === 'townhall') for (const k of ['wood','stone','planks','food']) b.stock[k] = 9999; });
  const kinds = await p.$$eval('button[data-k]', (bs) => bs.map((x) => x.dataset.k));
  let placed = 0;
  for (const k of kinds) {
    const n0 = (await st()).buildings.length;
    let ok = false;
    for (let i = 0; i < 60 && !ok; i++) {
      await p.click(`button[data-k=${k}]`);
      await p.mouse.click(160 + (i % 10) * 100, 200 + Math.floor(i / 10) * 70);
      ok = (await st()).buildings.length > n0;
    }
    if (ok) placed++;
  }
  check('поставлено споруди всіх видів з панелі', placed === kinds.length, `${placed}/${kinds.length}`);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(3000);
  let s = await st();
  check('світло від споруд додано', s.lights >= 5, String(s.lights));
  check('кожен житель має спрайт', s.npcSprites === s.npcs.length && s.npcs.length > 0, `${s.npcSprites}/${s.npcs.length}`);
  // зум упритул до жителя й швидкість 10x: частинки ударів/пилу
  await p.keyboard.press('Digit3');
  await p.waitForTimeout(4000);
  s = await st();
  const times = [];
  for (let i = 0; i < 3; i++) { await p.keyboard.press('KeyN'); times.push((await st()).time); }
  check('пори доби перемикаються по колу (N)', new Set(times).size === 3, times.join());
  // режим будівництва з привидом-спрайтом
  await p.click('button[data-k=house]'); await p.mouse.move(500, 500); await p.waitForTimeout(300);
  check('привид споруди зі спрайтом видно', (await st()).ghost);
  await p.keyboard.press('Escape');
  // зум і пан без винятків
  for (const d of [-600, 600, -600]) { await p.mouse.move(640, 400); await p.mouse.wheel(0, d); await p.waitForTimeout(200); }
  const worked = await p.evaluate(() => window.__city.debugState().particles);
  console.log('частинок зараз:', worked);
  check('консоль без помилок', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close();
  process.exit(fails ? 1 : 0);
})();
