// Headless: лобі -> «Нова гра» -> «Почати» -> вибір сектора -> «Грати» -> місто (потрібен доступ до PeerJS-сервера).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(process.env.URL || 'http://localhost:4173');
  await p.waitForSelector('#new'); await p.click('#new');
  const ok = await p.waitForSelector('#start', { timeout: 15000 }).then(() => true).catch(() => false);
  if (!ok) { console.log('кімната не створилась:', await p.textContent('#err').catch(() => '?')); await b.close(); process.exit(2); }
  await p.click('#start'); await p.waitForTimeout(800);
  const vp = p.viewportSize();
  for (const [dx, dy] of [[0,0],[300,0],[-300,0],[0,200],[0,-200],[300,200],[-300,-200]]) {
    await p.mouse.move(vp.width / 2 + dx, vp.height / 2 + dy); await p.mouse.down(); await p.mouse.up();
    if (!(await p.isDisabled('#play'))) break;
  }
  await p.click('#play'); await p.waitForTimeout(800);
  console.log('hud hidden (місто відкрито):', !(await p.isVisible('#hud')), '| errors:', errs.length ? errs : 'none');
  await b.close(); process.exit(errs.length ? 1 : 0);
})();
