// Headless: кнопка «Пауза» лісопильні перемикається з кожного кліку, поки панель оновлюється. Потрібен vite preview на :4173.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1100, height: 800 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(process.env.URL || 'http://localhost:4173');
  await p.waitForSelector('.lb button'); await p.evaluate(() => document.querySelector('.lb').remove());
  await p.waitForTimeout(500);
  for (const [dx, dy] of [[0,0],[300,0],[-300,0],[0,200],[0,-200],[300,200],[-300,-200]]) {
    await p.mouse.move(550 + dx, 400 + dy); await p.mouse.down(); await p.mouse.up();
    if (!(await p.isDisabled('#play'))) break;
  }
  await p.click('#play'); await p.waitForTimeout(800);
  await p.click('button[data-k=sawmill]');
  let ok = false;
  for (let k = 0; k < 200 && !ok; k++) {
    await p.mouse.move(500 + (k % 20) * 12, 330 + Math.floor(k / 20) * 12); await p.mouse.down(); await p.mouse.up();
    ok = (await p.textContent('#cityMsg')).startsWith('Побудовано');
  }
  console.log('built', ok);
  const bl = await p.evaluate(() => window.__city.debugState().buildings.slice(-1)[0]);
  await p.mouse.click(bl.sx, bl.sy); // кнопка паузи живе у вікні інформації про лісопильню
  await p.waitForSelector('button[data-pause]:not([hidden])');
  let paused = false, bad = 0;
  for (let i = 0; i < 12; i++) {
    await p.waitForTimeout(170 + (i % 4) * 90); // різні фази відносно перемальовування панелі
    await p.click('button[data-pause]');
    paused = !paused;
    const label = await p.textContent('button[data-pause]');
    if (label.includes('Пуск') !== paused) bad++;
  }
  console.log('mismatches', bad, 'errors', errs.length ? errs : 'none');
  await b.close(); process.exit(bad || errs.length || !ok ? 1 : 0);
})();
