// Headless: соло-потік карта -> примірка -> «Грати» -> місто, без помилок. (лобі приховуємо, мережа не потрібна)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(process.env.URL || 'http://localhost:4173');
  await p.waitForSelector('.lb button'); await p.evaluate(() => document.querySelector('.lb').remove());
  await p.waitForTimeout(500);
  const vp = p.viewportSize();
  const status = () => p.textContent('#status');
  console.log('0:', await status());
  for (const [dx, dy] of [[0,0],[300,0],[-300,0],[0,200],[0,-200],[300,200],[-300,-200],[-300,200],[300,-200]]) {
    await p.mouse.move(vp.width / 2 + dx, vp.height / 2 + dy); await p.mouse.down(); await p.mouse.up();
    if (!(await p.isDisabled('#play'))) break;
  }
  console.log('after clicks:', await status(), '| play disabled:', await p.isDisabled('#play'));
  await p.click('#play').catch((e) => console.log('play click failed', e.message.split('\n')[0]));
  await p.waitForTimeout(800);
  console.log('hud hidden after play:', !(await p.isVisible('#hud')));
  console.log('errors:', errs.length ? errs : 'none');
  await b.close(); process.exit(errs.length ? 1 : 0);
})();
