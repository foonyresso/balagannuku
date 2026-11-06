import { Application } from 'pixi.js';
import { MIN_START_DISTANCE } from './shared';
import { MapView, RESOURCE_COLORS, RESOURCE_NAMES } from './render/mapView';
import { canClaimStart, claimStart, createInitialState, DEFAULT_WORLD_RADIUS, SECTOR_RESOURCES } from './sim/worldgen';
import { mulberry32 } from './sim/rng';
import { mountLobby } from './ui';
import { ClientSession, HostSession, mkPlayer, type MapState } from './net';
import { CityView } from './render/cityView';
import { startCity, wrapState, type SimWorld } from './sim';

declare global { interface Window { __appStarted?: boolean; __showError?: (where: string, e: unknown) => void } }
window.__appStarted = true;
const showError = (where: string, e: unknown) => window.__showError?.(where, e);

// 1) Лобі — першим і окремо: працює навіть якщо графіка чи карта зламані.
try {
  const lobby = mountLobby({
    onHostStart: (hl, loaded) => { lobby.destroy(); startHost(hl, loaded as MapState | undefined); },
    onJoined: (cl, res) => { lobby.destroy(); startClient(cl, res.snapshot as unknown as MapState, res.player); },
  });
} catch (e) { showError('лобі', e); }

let me = 'p1';
let netRole: 'solo' | 'host' | 'client' = 'solo';
let host: HostSession | null = null;
let client: ClientSession | null = null;
let onSession: () => void = () => {};
const REASONS: Record<string, string> = {
  occupied: 'Сектор зайнятий', too_close_to_start: 'Надто близько до чужого старту', invalid: 'Старт уже обрано',
};

let minDist = MIN_START_DISTANCE;
let state!: MapState;
try { state = newWorld(Math.floor(Math.random() * 1e9)); } catch (e) { showError('генерація світу', e); }

function newWorld(seed: number) {
  return createInitialState(seed, DEFAULT_WORLD_RADIUS, minDist, [
    mkPlayer('p1', 'Ти', 0), mkPlayer('bot1', 'Суперник', 1),
  ]);
}

function startHost(hl: import('./net').HostLobby, loaded?: MapState): void {
  const players = hl.players().map((p, i) => mkPlayer(p.id, p.nickname, i));
  state = loaded ?? createInitialState(state.world.seed, DEFAULT_WORLD_RADIUS, minDist, players);
  me = hl.hostPlayer;
  netRole = 'host';
  host = new HostSession(hl, state);
  host.onChange = () => onSession();
  onSession();
}

function startClient(cl: import('./net').ClientLobby, snap: MapState, player: string): void {
  netRole = 'client';
  me = player;
  client = new ClientSession(cl, snap as never, player);
  state = client.state;
  client.onChange = () => onSession();
  client.onResult = (ok, reason) => { lastResult = ok ? 'Стартовий сектор обрано!' : REASONS[reason ?? 'invalid'] ?? 'Відмова'; onSession(); }
  onSession();
}
let lastResult = '';

async function startGraphics(): Promise<void> {

const app = new Application();
try {
  await app.init({ resizeTo: window, background: '#1a1420', antialias: true, preference: 'webgl' });
} catch (e) {
  showError('графіка (WebGL)', e);
  return;
}
document.getElementById('app')!.appendChild(app.canvas);
// 3) Карта й інтерфейс — окремий етап.
try {

const view = new MapView(app, () => state);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const tip = $('tip'), status = $('status');

view.blocked = (id) => !canClaimStart(state, me, id).ok;
const myPlayer = () => state.players.find((p) => p.id === me);

view.onHover = (id, x, y) => {
  if (city) return;
  if (id === null) { tip.style.display = 'none'; return; }
  const s = state.sectors[id];
  const rows = SECTOR_RESOURCES.map(({ kind }) => {
    const v = s.richness[kind] ?? 0;
    return `<div class="row"><i style="background:#${RESOURCE_COLORS[kind].toString(16).padStart(6, '0')}"></i>` +
      `<span>${RESOURCE_NAMES[kind]}</span><b>${Math.round(v * 100)}%</b></div>`;
  }).join('');
  const owner = s.owner ? state.players.find((p) => p.id === s.owner)!.nickname : 'вільний';
  const claim = canClaimStart(state, me, id);
  const hint = myPlayer()?.homeSector === null
    ? (claim.ok ? '<em>Клік — обрати стартом</em>' : `<em class="bad">${REASONS[claim.reason]}</em>`) : '';
  tip.innerHTML = `<h3>Сектор ${s.hex.q},${s.hex.r}</h3><div>${owner}</div>${rows}${hint}`;
  tip.style.display = 'block';
  tip.style.left = `${Math.min(x + 16, window.innerWidth - tip.offsetWidth - 8)}px`;
  tip.style.top = `${Math.min(y + 16, window.innerHeight - tip.offsetHeight - 8)}px`;
};

view.onClick = (id) => {
  if (netRole === 'client') {
    const c = canClaimStart(state, me, id);
    if (!c.ok) { status.textContent = REASONS[c.reason]; return; }
    status.textContent = 'Надсилаю хосту…';
    client!.claim(id);
    return;
  }
  const r = host ? host.claim(me, id) : claimStart(state, me, id);
  status.textContent = r.ok ? 'Стартовий сектор обрано!' : REASONS[r.reason];
  view.redraw();
  onSession();
};

function placeBot(): void {
  const rnd = mulberry32(state.world.seed ^ 0xb07);
  const ids = state.sectors.map((s) => s.id).sort(() => rnd() - 0.5);
  const id = ids.find((i) => canClaimStart(state, 'bot1', i).ok);
  if (id !== undefined) claimStart(state, 'bot1', id);
}

// Етап економіки (поки лише соло): вигляд міста домашнього сектора.
let city: CityView | null = null;
let sim: SimWorld | null = null;
const cityBtn = $<HTMLButtonElement>('enterCity');
const exitCity = () => { city?.destroy(); city = null; view.world.visible = true; $('hud').style.display = ''; };
cityBtn.onclick = () => {
  const home = myPlayer()?.homeSector;
  if (home === null || home === undefined || netRole !== 'solo') return;
  if (!sim) { sim = wrapState(state as never); startCity(sim, me); }
  view.world.visible = false; tip.style.display = 'none'; $('hud').style.display = 'none';
  city = new CityView(app, sim, me, home, exitCity);
};

onSession = () => {
  const mine = myPlayer();
  cityBtn.style.display = netRole === 'solo' && mine?.homeSector != null ? '' : 'none';
  if (lastResult) { status.textContent = lastResult; lastResult = ''; }
  else if (mine?.homeSector === null) status.textContent = 'Обери стартовий сектор';
  else if (mine) status.textContent = 'Стартовий сектор обрано!';
  ($('newWorld') as HTMLButtonElement).disabled = netRole !== 'solo';
  ($('dist') as HTMLInputElement).disabled = netRole !== 'solo';
  view.blocked = (id) => !canClaimStart(state, me, id).ok;
  view.redraw();
};

function reset(): void {
  if (netRole !== 'solo') return;
  exitCity();
  sim = null;
  state = newWorld(Math.floor(Math.random() * 1e9));
  status.textContent = 'Обери стартовий сектор';
  placeBot();
  view.redraw();
}

$('newWorld').onclick = reset;
const dist = $<HTMLInputElement>('dist');
dist.value = String(minDist);
dist.oninput = () => {
  minDist = Number(dist.value);
  $('distVal').textContent = String(minDist);
  state.world.minStartDistance = minDist;
  view.redraw();
};
$('distVal').textContent = String(minDist);

const ui = $<HTMLInputElement>('uiScale');
const applyScale = () => {
  document.documentElement.style.setProperty('--ui', ui.value);
  $('uiVal').textContent = `${Math.round(Number(ui.value) * 100)}%`;
  try { localStorage.setItem('uiScale', ui.value); } catch { /* ignore */ }
};
try { ui.value = localStorage.getItem('uiScale') ?? '1'; } catch { /* ignore */ }
ui.oninput = applyScale;
applyScale();

reset();
onSession();
app.renderer.on('resize', () => view.redraw());
} catch (e) { showError('карта', e); }
}
void startGraphics();
