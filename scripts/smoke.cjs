// Headless-перевірка: кліки по кнопках лобі без помилок у консолі. Запуск: npm run build && npx vite preview --port 4173 & node scripts/smoke.cjs
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(process.env.URL || 'http://localhost:4173');
  await p.waitForSelector('.lb button');
  for (const id of ['#join', '#new']) { await p.click(id); await p.waitForTimeout(800); if (!(await p.$('#new'))) await p.waitForTimeout(500); }
  await p.fill('#code', 'ABCDE').catch(() => {});
  await p.click('#join').catch(() => {});
  await p.waitForTimeout(2500);
  console.log('lobby err text:', await p.textContent('#err').catch(() => '(menu replaced)'));
  const real = errs.filter((e) => !/net::|Failed to load resource|WebSocket|peerjs|ERR_/i.test(e));
  console.log('page errors:', real.length ? real : 'none');
  await b.close();
  process.exit(real.length ? 1 : 0);
})();
