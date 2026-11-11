// Headless: лісоруб рубає дерево, воно падає (анімація), лишається пеньок, дерево відростає стадіями; консоль без помилок. Потрібен vite preview на :4173.
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
  for (const [dx, dy] of [[0,0],[300,0],[-300,0],[0,200],[0,-200],[300,200],[-300,-200],[-300,200],[300,-200]]) {
    await p.mouse.move(400 + dx, 250 + dy); await p.mouse.down(); await p.mouse.up();
    if (!(await p.isDisabled('#play'))) break;
  }
  await p.click('#play'); await p.waitForSelector('#cityHud'); await p.waitForTimeout(1500);
  await p.evaluate(() => {
    const c = window.__city, th = c.w.state.buildings.find((x) => x.kind === 'townhall');
    for (let i = 0; i < 600; i++) {
      if (c.cmd({ type: 'place_building', kind: 'lumberjack', sector: c.sector, cell: { x: th.cell.x - 80 + (i % 25) * 8, y: th.cell.y - 60 + Math.floor(i / 25) * 8 } }).ok) break;
    }
    window.__maxFalling = 0; window.__felled = 0;
    setInterval(() => { window.__maxFalling = Math.max(window.__maxFalling, c.debugState().falling); }, 50);
  });
  await p.keyboard.press('Digit3');
  let felled = 0, maxFalling = 0;
  for (let i = 0; i < 40 && !(felled > 0 && maxFalling > 0); i++) {
    await p.waitForTimeout(500);
    ({ felled, maxFalling } = await p.evaluate(() => {
      const c = window.__city, rt = c.w.sectors.get(c.sector); let st = 0;
      for (let k = 0; k < rt.kind.length; k++) if (rt.kind[k] === 1 && rt.amount[k] === 0) st++;
      return { felled: st, maxFalling: window.__maxFalling };
    }));
  }
  check('дерево зрубано (пеньок у стані)', felled > 0, String(felled));
  check('анімація падіння запускалась', maxFalling > 0, String(maxFalling));
  await p.waitForTimeout(3000);
  const left = await p.evaluate(() => window.__city.debugState().falling);
  check('падаючі спрайти прибираються (одночасно мало)', left <= 12, String(left));
  check('консоль без помилок', errs.length === 0, errs.join(' | '));
  await b.close();
  process.exit(fails ? 1 : 0);
})();
