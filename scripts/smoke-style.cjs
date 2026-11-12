// Перевірка спрайтів стилю «Kingdom» без скріншотів: цілісність силуету персонажів (ноги прикріплені до тіла),
// кадри ходьби, межі й якір споруд. Потрібен dev-сервер vite на :5173 (npx vite --port 5173).
// check: dev (імпортує сирці /src/...)
const { chromium } = require('playwright');
let fails = 0;
const check = (name, ok, extra = '') => { console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : extra); if (!ok) fails++; };
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(process.env.URL || 'http://localhost:5173/__blank.html').catch(() => {});
  await p.goto((process.env.URL || 'http://localhost:5173') + '/');
  const res = await p.evaluate(async () => {
    const st = await import('/src/render/style/index.ts');
    st.registerStyleDefs(4);
    const out = { chars: [], blds: [] };
    const analyze = (cv) => {
      const { width: w, height: h } = cv, d = cv.getContext('2d').getImageData(0, 0, w, h).data;
      const solid = new Uint8Array(w * h);
      let minX = w, minY = h, maxX = -1, maxY = -1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 200) { solid[y * w + x] = 1; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      // 8-зв'язні компоненти
      const seen = new Uint8Array(w * h); let comps = 0;
      for (let i = 0; i < w * h; i++) if (solid[i] && !seen[i]) { comps++; const q = [i]; seen[i] = 1; while (q.length) { const j = q.pop(), x = j % w, y = (j / w) | 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const k = ny * w + nx; if (solid[k] && !seen[k]) { seen[k] = 1; q.push(k); } } } }
      return { w, h, minX, minY, maxX, maxY, comps };
    };
    for (const id of st.spriteIds()) {
      const def = st.spriteDef(id);
      if (id.startsWith('ch:')) out.chars.push({ id, ay: def.ay, ...analyze(st.renderSprite(id)) });
      if (id.startsWith('bld:')) out.blds.push({ id, ax: def.ax, ay: def.ay, ...analyze(st.renderSprite(id)) });
    }
    return out;
  });
  check('є кадри персонажів', res.chars.length > 100, String(res.chars.length));
  const split = res.chars.filter((c) => c.comps !== 1);
  check('кожен кадр персонажа — ОДИН суцільний силует (ноги прикріплені до тіла)', split.length === 0, split.slice(0, 5).map((c) => c.id + ':' + c.comps).join(' '));
  const walk = res.chars.filter((c) => /:(walk|idle)\d$/.test(c.id));
  const floating = walk.filter((c) => c.maxY !== c.ay - 1);
  check('у ходьбі/спокої одна нога завжди на землі', floating.length === 0, floating.slice(0, 5).map((c) => c.id + ':' + c.maxY).join(' '));
  const clipped = res.chars.filter((c) => c.minX < 1 || c.minY < 1 || c.maxX > c.w - 2);
  check('персонажі не обрізані полотном', clipped.length === 0, clipped.slice(0, 5).map((c) => c.id).join(' '));
  check('є споруди', res.blds.length >= 9, String(res.blds.length));
  const bad = res.blds.filter((c) => c.minX < 1 || c.minY < 1 || c.maxX > c.w - 2 || c.maxY > c.h - 2);
  check('споруди не обрізані полотном', bad.length === 0, bad.map((c) => c.id + JSON.stringify([c.minX, c.minY, c.maxX, c.maxY, c.w, c.h])).join(' '));
  const off = res.blds.filter((c) => c.maxY > c.ay + 4 || c.maxY < c.ay - 12);
  check('низ споруди лежить на якорі (фасад стоїть на землі проєкції)', off.length === 0, off.map((c) => c.id + ':' + c.maxY + '/' + c.ay).join(' '));
  check('без помилок сторінки', errs.length === 0, errs.join(' | '));
  await b.close();
  process.exit(fails ? 1 : 0);
})();
