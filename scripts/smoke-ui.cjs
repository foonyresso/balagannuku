// Headless-сценарій інтерфейсу міста: режим будівництва/вибору, інформація про об'єкти, стеження камери. Потрібен vite preview на :4173.
const { chromium } = require('playwright');
let fails = 0;
const check = (name, ok, extra = '') => { console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : extra); if (!ok) fails++; };
// Перевірки, що залежать від частоти кадрів: на повільній графіці (software GL у контейнері, < 20 кадрів/с) провал — лише «warn».
let slowGl = false;
const perf = (name, ok, extra = '') => (slowGl && !ok ? console.log('warn', name, extra, '(повільна графіка, не рахується)') : check(name, ok, extra));
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
  await p.click('#play'); await p.waitForSelector('#cityHud'); await p.waitForTimeout(800);
  const st = () => p.evaluate(() => window.__city.debugState());
  const nb = async () => (await st()).buildings.length;
  const msg = () => p.textContent('#cityMsg');

  let s = await st();
  check('старт: режим «вибір» (нічого не вибрано для будівництва)', s.build === null && s.sel === null);
  const n0 = await nb();
  await p.mouse.click(300, 600); await p.waitForTimeout(100);
  check('клік по карті без вибору не будує', (await nb()) === n0);

  check('нижня панель: усі розділи', (await p.$$('#cityDock button.dock-btn')).length >= 3);
  check('вікна закриті на старті', !(await p.isVisible('.kwin')));
  await p.click('button.dock-btn[data-win=build]');
  check('кнопка «Будівництво» відкриває пласке вікно над панеллю', await p.isVisible('.kwin[data-win=build]') && (await p.getAttribute('.kwin[data-win=build]', 'data-place')) === 'dock');
  await p.click('[data-wtab=mood]');
  check('вкладка без споруд показує заглушку', (await p.textContent('[data-pane=mood]')).trim().length > 5 && !(await p.$('[data-pane=mood] button[data-k]')));
  await p.click('[data-wtab=housing]');
  check('вкладка «Житло» має споруди', !!(await p.$('[data-pane=housing] button[data-k=house]')));
  await p.click('[data-wtab=resources]');
  await p.click('button[data-k=quarry]');
  check('вибір будівлі вмикає режим будівництва', (await st()).build === 'quarry');
  await p.keyboard.press('Escape');
  check('Esc скасовує будівництво', (await st()).build === null);
  await p.click('button[data-k=quarry]');
  await p.mouse.move(500, 500); await p.waitForTimeout(150);
  check('режим будівництва: видно прозорий «привид» будівлі', (await st()).ghost);
  const L = (await st()).layers;
  check('контур footprint лежить під голограмою (земля < контур < привид < рамки)', L.ground < L.base && L.base < L.ghost && L.ghost < L.hover, JSON.stringify(L));
  await p.mouse.click(300, 450, { button: 'right' });
  await p.waitForTimeout(100);
  check('після скасування привид зникає', !(await st()).ghost);
  check('ПКМ скасовує будівництво', (await st()).build === null);

  await p.click('button[data-k=lumberjack]');
  let built = false;
  for (let k = 0; k < 200 && !built; k++) {
    await p.mouse.click(300 + (k % 20) * 25, 300 + Math.floor(k / 20) * 25);
    built = (await nb()) > n0;
    if (!built && (await st()).build === null) await p.click('button[data-k=lumberjack]');
  }
  check('будівля поставлена', built, await msg());
  check('після споруди курсор порожній (build=null)', (await st()).build === null);
  const n1 = await nb();
  await p.mouse.click(1000, 650); await p.waitForTimeout(100);
  check('наступний клік по землі нічого не будує', (await nb()) === n1);

  // Інформація про споруду
  s = await st();
  const bl = s.buildings[s.buildings.length - 1];
  await p.mouse.click(bl.sx, bl.sy);
  s = await st();
  check('клік по споруді виділяє її', s.sel && s.sel.t === 'building' && s.sel.id === bl.id, JSON.stringify(s.sel));
  check('вікно інформації видно', await p.isVisible('#cityInfo'));
  const txt = await p.textContent('#cityInfo');
  check('вікно: Працівники X/Y, Ефективність, Стан', /Працівники\s*\d+\/\d+/.test(txt) && /Ефективність/.test(txt) && /Стан/.test(txt), txt);
  await p.keyboard.press('Escape');
  check('Esc знімає виділення', (await st()).sel === null && !(await p.isVisible('#cityInfo')));

  // Житель: виділення + стеження камери
  s = await st();
  const z0 = s.zoom;
  const npc = s.npcs[0];
  await p.mouse.click(npc.sx, npc.sy);
  s = await st();
  check('клік по жителю виділяє його', s.sel && s.sel.t === 'npc', JSON.stringify(s.sel));
  check('камера НЕ слідує за виділеним за замовчуванням', !s.following && s.zoom === z0, String(s.zoom));
  const cam0 = await p.evaluate(() => window.__city.debugState().npcs.length && JSON.stringify(window.__city.debugState().buildings[0]));
  await p.waitForTimeout(1500);
  check('камера не рухається сама', JSON.stringify((await st()).buildings[0]) === cam0);
  await p.click('#infoFollow'); // необов'язкове стеження вмикається кнопкою
  await p.waitForTimeout(1500);
  s = await st();
  check('кнопка «Слідкувати» вмикає стеження', s.following);
  const me = s.npcs.find((n) => n.id === s.sel.id);
  const fps = await p.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; performance.now() - t0 < 1000 ? requestAnimationFrame(f) : res(n); }; requestAnimationFrame(f); }));
  slowGl = fps < 20;
  perf('камера наблизилась', s.zoom > z0 && s.zoom > 3, String(s.zoom));
  check('житель біля центру екрана', Math.abs(me.sx - 640) < 40 && Math.abs(me.sy - 400) < 40, JSON.stringify(me));
  const itxt = await p.textContent('#cityInfo');
  check('вікно жителя: ім’я, зараз, професія', /Зараз/.test(itxt) && /Професія/.test(itxt) && (await p.textContent('#infoTitle')).trim().length > 3, itxt);
  await p.waitForTimeout(2000);
  s = await st();
  const me2 = s.npcs.find((n) => n.id === s.sel.id);
  check('камера слідує за рухомим жителем', Math.abs(me2.sx - 640) < 40 && Math.abs(me2.sy - 400) < 40, JSON.stringify(me2));
  // ручний пан знімає стеження, виділення лишається
  await p.mouse.move(300, 300); await p.mouse.down({ button: 'right' }); await p.mouse.move(340, 330, { steps: 4 }); await p.mouse.up({ button: 'right' }); // пан — ПКМ
  s = await st();
  check('пан знімає стеження, виділення лишається', !s.following && s.sel && s.sel.t === 'npc');
  await p.click('#infoFollow');
  check('кнопка «Слідкувати» вмикає знову', (await st()).following);

  // Виділення рамкою (на паузі позиції стабільні)
  await p.keyboard.press('Escape');
  await p.click('button[data-speed="0"]');
  await p.mouse.move(640, 300);
  for (let k = 0; k < 12 && (await st()).zoom > 1.2; k++) { await p.mouse.wheel(0, 400); await p.waitForTimeout(60); }
  await p.waitForTimeout(400);
  s = await st();
  const inView = s.npcs.filter((n) => n.sx > 40 && n.sx < 1240 && n.sy > 80 && n.sy < 560);
  check('є жителі для виділення рамкою', inView.length >= 2, String(inView.length));
  if (inView.length >= 2) {
    const x0 = Math.min(...inView.map((n) => n.sx)) - 12, x1 = Math.max(...inView.map((n) => n.sx)) + 12;
    const y0 = Math.min(...inView.map((n) => n.sy)) - 12, y1 = Math.max(...inView.map((n) => n.sy)) + 12;
    const expected = s.npcs.filter((n) => n.sx >= x0 && n.sx <= x1 && n.sy >= y0 && n.sy <= y1).length;
    await p.mouse.move(x0, y0); await p.mouse.down(); await p.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 });
    check('під час перетягування видно рамку', await p.isVisible('#selBox'));
    await p.mouse.move(x1, y1, { steps: 4 }); await p.mouse.up();
    s = await st();
    check('рамка виділяє групу жителів (пріоритет NPC)', s.sel?.t === 'group' && s.sel.items.length === expected && s.sel.items.every((i) => i.t === 'npc'), JSON.stringify(s.sel).slice(0, 120) + ' очікувалось ' + expected);
    const gtxt = await p.textContent('#cityInfo');
    check('вікно групи: кількість і стани', /Жителів/.test(gtxt) && /Стани/.test(gtxt), gtxt);
    await p.locator('#infoItems .row').first().dispatchEvent('pointerdown');
    check('клік по рядку групи вибирає одного', (await st()).sel?.t === 'npc');
    check('рамка не зсунула камеру при ЛКМ-перетягуванні', !(await st()).following);
    // Shift додає
    await p.keyboard.press('Escape');
    const a = inView[0], b = inView[1];
    await p.mouse.click(a.sx, a.sy);
    await p.keyboard.down('Shift');
    await p.mouse.click(b.sx, b.sy);
    await p.keyboard.up('Shift');
    s = await st();
    check('Shift+клік додає до виділення', s.sel?.t === 'group' && s.sel.items.length === 2, JSON.stringify(s.sel).slice(0, 100));
    await p.keyboard.press('Escape');
  }
  // Рамка без жителів: споруда
  s = await st();
  const bld = s.buildings[0];
  const near = s.npcs.filter((n) => Math.abs(n.sx - bld.sx) < 40 && Math.abs(n.sy - bld.sy) < 40).length;
  await p.mouse.move(bld.sx - 4, bld.sy - 4); await p.mouse.down(); await p.mouse.move(bld.sx + 4, bld.sy + 4, { steps: 3 }); await p.mouse.up();
  s = await st();
  check('рамка без жителів вибирає споруду', near > 0 || s.sel?.t === 'building' || (s.sel?.t === 'group' && s.sel.items[0].t === 'building'), JSON.stringify(s.sel));
  await p.keyboard.press('Escape');
  // Порожня рамка знімає виділення
  await p.mouse.move(10, 700); await p.mouse.down(); await p.mouse.move(20, 705, { steps: 3 }); await p.mouse.up();
  check('порожня рамка нічого не вибирає', (await st()).sel === null);
  // Рухомі жителі: клік на 2×–10× влучає
  for (const sp of [2, 10]) {
    await p.click(`button[data-speed="${sp}"]`);
    let hit = 0;
    for (let k = 0; k < 6; k++) {
      s = await st();
      const cand = s.npcs.filter((n) => n.sx > 40 && n.sx < 1240 && n.sy > 80 && n.sy < 560);
      if (!cand.length) break;
      await p.mouse.click(cand[0].sx, cand[0].sy);
      if ((await st()).sel?.t === 'npc') hit++;
      await p.keyboard.press('Escape');
    }
    check(`клік по рухомому жителю на ${sp}× влучає`, hit >= 5, String(hit));
  }
  await p.click('button[data-speed="1"]');

  // Вкладки
  await p.keyboard.press('Escape');
  await p.click('button.dock-btn[data-win=npcs]'); await p.waitForTimeout(300);
  check('розділ «Жителі» відкривається в центрі екрана і закриває вікно будівництва', await p.isVisible('.kwin[data-win=npcs]') && !(await p.isVisible('.kwin[data-win=build]')));
  const bx = await p.evaluate(() => { const r = document.querySelector('.kwin[data-win=npcs]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  check('вікно по центру', Math.abs(bx[0] - 640) < 30 && Math.abs(bx[1] - 400) < 60, JSON.stringify(bx));
  const rows = await p.$$('#peopleList .row');
  check('жителі картками', rows.length > 0 && (await rows[0].$('.av')) !== null);
  await rows[0].dispatchEvent('pointerdown', { bubbles: true });
  check('клік по картці жителя виділяє його', (await st()).sel?.t === 'npc');
  await p.keyboard.press('Escape');
  check('Esc закриває вікно в центрі', !(await p.isVisible('.kwin[data-win=npcs]')) && (await st()).sel?.t === 'npc');
  await p.click('button.dock-btn[data-win=economy]'); await p.waitForTimeout(300);
  const prows = await p.$$('[data-pane=prod] .row');
  check('«Економіка → Виробництво» має рядки', prows.length > 0);
  await prows[0].dispatchEvent('pointerdown', { bubbles: true });
  check('клік по рядку споруди виділяє її', (await st()).sel?.t === 'building');
  await p.click('[data-wtab=res]');
  check('«Економіка → Ресурси» показує запаси', /[0-9]/.test(await p.textContent('[data-pane=res]')));
  await p.click('button.dock-btn[data-win=economy]');
  check('повторний клік по кнопці закриває вікно', !(await p.isVisible('.kwin[data-win=economy]')));


  // Робітники: +/−, вільні/зайняті, призначення
  const slots = async () => (await p.textContent('#slotNum')).trim();
  const cur = async () => Number((await slots()).split('/')[0]);
  await p.evaluate((id) => window.__city.select({ t: 'building', id }, false), bl.id);
  await p.waitForTimeout(300);
  const c0 = await cur();
  check('у споруді є слоти X/Y і працівники', c0 > 0, await slots());
  await p.click('button[data-slot="-"]'); await p.waitForTimeout(300);
  check('«−» зменшує кількість працівників', (await cur()) === c0 - 1, await slots());
  await p.click('button.dock-btn[data-win=npcs]'); await p.waitForTimeout(300);
  await p.click('button[data-f=free]'); await p.waitForTimeout(300);
  check('вкладка «Вільні» показує звільненого', (await p.$$('#peopleList .row')).length >= 1);
  await p.click('button[data-f=busy]'); await p.waitForTimeout(300);
  check('вкладка «Зайняті» має рядки', (await p.$$('#peopleList .row')).length >= 1);
  await p.click('button.dock-btn[data-win=npcs]');
  await p.click('button[data-slot="+"]'); await p.waitForTimeout(300);
  check('«+» не перевищує максимум', (await cur()) <= Number((await slots()).split('/')[1]), await slots());
  const npcId = await p.evaluate(() => window.__city.debugState().npcs[0].id);
  await p.evaluate((id) => window.__city.select({ t: 'npc', id }, false), npcId);
  await p.waitForTimeout(300);
  const info = await p.textContent('#cityInfo');
  check('вікно жителя: Перки і «Призначити на роботу»', /Перки/.test(info) && /Призначити на роботу/.test(info), info);
  const btn = await p.$('#infoAssign button');
  if (btn) {
    await btn.click(); await p.waitForTimeout(300);
    const t2 = (await p.textContent('#cityInfo')).replace(/\s/g, '');
    check('призначення у споруду з вікна жителя', !t2.includes('Роботанемає'), t2);
  }
  await p.keyboard.press('Escape');

  // Керування часом
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape');
  const rate = async (ms) => { const a = (await st()).tick; await p.waitForTimeout(ms); return ((await st()).tick - a) / (ms / 1000); };
  await p.click('button[data-speed="1"]');
  const r1 = await rate(2000);
  perf('1× ≈ 10 тіків/с', r1 > 4 && r1 < 13, String(r1));
  await p.click('button[data-speed="5"]');
  const r5 = await rate(2000);
  check('5× помітно швидше за 1×', r5 > r1 * 2.5 && r5 < 65, `${r5} vs ${r1}`);
  await p.click('button[data-speed="100"]');
  const r100 = await rate(2000);
  check('100× набагато швидше за 10×, вкладка жива', r100 > 100, String(r100));
  console.log('   100× фактично', Math.round(r100 / 10) + '×', 'текст:', await p.textContent('#speedActual'));
  await p.click('button[data-speed="0"]');
  await p.waitForTimeout(300);
  const t0 = (await st()).tick; await p.waitForTimeout(1000);
  check('пауза зупиняє тіки', (await st()).tick === t0);
  await p.keyboard.press('Space');
  check('Пробіл знімає паузу', (await st()).speed === 100 && (await st()).tick >= t0);
  await p.keyboard.press('Space');
  check('Пробіл ставить паузу', (await st()).speed === 0);
  await p.keyboard.press('Digit2');
  check('клавіша 2 = 2×', (await st()).speed === 2);
  await p.click('button[data-speed="1"]');

  // Стабільність позицій кнопок при зміні динамічного тексту
  const xs = () => p.evaluate(() => [...document.querySelectorAll('#citySpeed button, #cityBack, #cityDock button')].map((e) => Math.round(e.getBoundingClientRect().left * 10) / 10));
  const xs0 = await xs();
  for (const t of ['', 'фактично ≈1.6×', 'фактично ≈100×', 'керує хост']) {
    await p.evaluate((x) => { document.querySelector('#speedActual').textContent = x; }, t);
    await p.evaluate((x) => { document.querySelector('#cityRes').textContent = x; }, t ? t.repeat(3) : 'Дерево: 5');
    check(`кнопки не зсуваються при тексті «${t}»`, JSON.stringify(await xs()) === JSON.stringify(xs0));
  }
  await p.click('button.dock-btn[data-win=npcs]');
  const f0 = await p.evaluate(() => [...document.querySelectorAll('#peopleFilter button')].map((e) => Math.round(e.getBoundingClientRect().left)));
  await p.evaluate(() => { document.querySelectorAll('#peopleFilter button').forEach((b, i) => { b.textContent = ['Усі (1)', 'Вільні (1234)', 'Зайняті (0)'][i]; }); });
  check('фільтри Усі/Вільні/Зайняті не зсуваються при зміні лічильників', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('#peopleFilter button')].map((e) => Math.round(e.getBoundingClientRect().left)))) === JSON.stringify(f0));
  await p.click('button.dock-btn[data-win=npcs]');

  console.log('errors', errs.length ? errs : 'none');
  if (errs.length) fails++;
  await b.close(); process.exit(fails ? 1 : 0);
})();
