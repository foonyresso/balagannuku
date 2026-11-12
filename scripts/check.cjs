// Єдина перевірка репозиторію: карти файлів у CLAUDE.md, типи, юніт-тести, збірка, headless-смоуки.
// Друкує один рядок на етап; вивід етапу показує лише при провалі (хвіст), щоб не засмічувати контекст.
//   node scripts/check.cjs               усе (кілька хвилин)
//   node scripts/check.cjs --fast        карти + типи + тести без бенчмарків (без збірки й смоуків)
//   node scripts/check.cjs --smoke ui    збірка + один смоук (scripts/smoke-ui.cjs)
//   node scripts/check.cjs --tail 200    скільки рядків виводу показувати при провалі (типово 60)
// Смоук, якому бракує зовнішньої мережі (сервер PeerJS), завершується кодом 2: це «skip», а не провал.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const FAST = flag('--fast');
const ONLY_SMOKE = opt('--smoke');
const TAIL = Number(opt('--tail') ?? 60);
const SMOKE_TIMEOUT_MS = 180000;
const bin = (p) => path.join(ROOT, 'node_modules', p);

let failed = 0;
const report = (name, ok, ms, out, skip = false) => {
  if (skip) { console.log(`skip ${name}: ${out.trim().split('\n').pop()}`); return; }
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} (${(ms / 1000).toFixed(1)}s)`);
  if (ok) return;
  failed++;
  const lines = out.trimEnd().split('\n');
  if (lines.length > TAIL) console.log(`... (${lines.length - TAIL} рядків вище приховано, --tail N покаже більше)`);
  console.log(lines.slice(-TAIL).join('\n'));
};

function run(name, file, argv, env = {}, timeoutMs = 0, skipCode = -1) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let out = '';
    const c = spawn(process.execPath, [file, ...argv], { cwd: ROOT, env: { ...process.env, ...env } });
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (out += d));
    const timer = timeoutMs ? setTimeout(() => { out += `\n[check] таймаут ${timeoutMs / 1000}s`; c.kill('SIGKILL'); }, timeoutMs) : null;
    c.on('close', (code) => {
      if (timer) clearTimeout(timer);
      report(name, code === 0, Date.now() - t0, out, code === skipCode);
      resolve(code === 0);
    });
  });
}

/** Кожен файл коду має бути згаданий у найближчому CLAUDE.md (карта файлів не відстає від коду). */
function checkMaps() {
  const t0 = Date.now();
  const missing = [];
  const walk = (dir, map) => {
    const own = path.join(dir, 'CLAUDE.md');
    if (fs.existsSync(own)) map = { file: own, text: fs.readFileSync(own, 'utf8') };
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p, map); continue; }
      if (!/\.(ts|css)$/.test(e.name) || /\.test\.ts$/.test(e.name) || e.name === 'index.ts') continue;
      if (!map.text.includes(e.name)) missing.push(`${path.relative(ROOT, p)}: додай рядок у ${path.relative(ROOT, map.file)}`);
    }
  };
  const rootMap = path.join(ROOT, 'CLAUDE.md');
  walk(path.join(ROOT, 'src'), { file: rootMap, text: fs.existsSync(rootMap) ? fs.readFileSync(rootMap, 'utf8') : '' });
  report('карти файлів у CLAUDE.md', missing.length === 0, Date.now() - t0, missing.join('\n'));
}

const freePort = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
const waitHttp = (url, ms) => new Promise((resolve) => {
  const end = Date.now() + ms;
  const tick = () => {
    http.get(url, (r) => { r.resume(); resolve(true); }).on('error', () => (Date.now() > end ? resolve(false) : setTimeout(tick, 200)));
  };
  tick();
});

/** Піднімає vite (preview зі збірки або dev із сирців) на вільному порту; повертає url і функцію зупинки. */
async function serve(mode) {
  const port = await freePort();
  const url = `http://localhost:${port}`;
  const srv = spawn(process.execPath, [bin('vite/bin/vite.js'), ...(mode === 'dev' ? [] : ['preview']), '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  if (await waitHttp(url, 20000)) return { url, stop: () => srv.kill() };
  srv.kill();
  report(`vite ${mode}`, false, 20000, 'сервер не піднявся');
  return null;
}

async function smokes() {
  const all = fs.readdirSync(__dirname).filter((f) => /^smoke.*\.cjs$/.test(f)).sort();
  const list = ONLY_SMOKE ? all.filter((f) => f === `smoke-${ONLY_SMOKE}.cjs` || f === `${ONLY_SMOKE}.cjs`) : all;
  if (!list.length) { report(`смоук «${ONLY_SMOKE}»`, false, 0, `немає такого; є: ${all.join(', ')}`); return; }
  // Смоук із рядком «// check: dev» іде на dev-сервері (імпортує сирці або мокає модулі за URL); решта — на preview зі збірки.
  const needsDev = (f) => /^\/\/ check: dev\b/m.test(fs.readFileSync(path.join(__dirname, f), 'utf8'));
  for (const mode of ['preview', 'dev']) {
    const group = list.filter((f) => needsDev(f) === (mode === 'dev'));
    if (!group.length) continue;
    const s = await serve(mode);
    if (!s) continue;
    try {
      for (const f of group) await run(f.replace(/\.cjs$/, ''), path.join(__dirname, f), [], { URL: s.url }, SMOKE_TIMEOUT_MS, 2);
    } finally { s.stop(); }
  }
}

(async () => {
  const t0 = Date.now();
  if (!ONLY_SMOKE) {
    checkMaps();
    await run('типи (tsc)', bin('typescript/bin/tsc'), ['--noEmit']);
    await run(FAST ? 'юніт-тести без бенчмарків' : 'юніт-тести', bin('vitest/vitest.mjs'), ['run', ...(FAST ? ['--exclude', '**/bench.test.ts'] : [])]);
  }
  if (!FAST) {
    if (await run('збірка (vite build)', bin('vite/bin/vite.js'), ['build'])) await smokes();
  }
  console.log(`${failed ? `ПРОВАЛ: ${failed}` : 'УСЕ ГАРАЗД'} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  process.exit(failed ? 1 : 0);
})();
