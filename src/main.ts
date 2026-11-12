import { Application } from 'pixi.js';
import { MIN_START_DISTANCE } from './shared';
import { MapView, RESOURCE_COLORS, RESOURCE_NAMES } from './render/mapView';
import { canClaimStart, claimStart, createInitialState, DEFAULT_WORLD_RADIUS, SECTOR_RESOURCES } from './sim/worldgen';
import { mulberry32 } from './sim/rng';
import { mountLobby } from './ui';
import { ClientSession, HostSession, mkPlayer, type MapState } from './net';
import { CityView } from './render/city';
import { startCity, wrapState, type SimWorld } from './sim';
import { mountSaveMenu, SaveController, takeLoaded, type LoadedGame } from './persist';

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
/** Робочий світ міста (симуляція). Із сейва приходить уже готовим. */
let sim: SimWorld | null = null;
let graphicsReady = false;
let autoEnter = false;
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

window.setInterval(() => host?.setSpeed(gameSpeed), 2000); // пізні гості й перепідключення дізнаються швидкість

function startHost(hl: import('./net').HostLobby, loaded?: MapState): void {
  const players = hl.players().map((p, i) => mkPlayer(p.id, p.nickname, i));
  state = loaded ?? createInitialState(state.world.seed, DEFAULT_WORLD_RADIUS, minDist, players);
  me = hl.hostPlayer;
  netRole = 'host';
  const g = loaded && takeLoaded(loaded as never);
  if (g) { sim = g.world; gameSpeed = g.speed; } // «Продовжити»: світ і швидкість зі сейва
  host = new HostSession(hl, state);
  host.setSpeed(gameSpeed);
  host.onChange = () => onSession();
  onSession();
  if (g) { if (graphicsReady) enterCityNow(); else autoEnter = true; }
}

function startClient(cl: import('./net').ClientLobby, snap: MapState, player: string): void {
  netRole = 'client';
  me = player;
  client = new ClientSession(cl, snap as never, player);
  state = client.state;
  client.onChange = () => onSession();
  client.onSpeed = (v) => { gameSpeed = v; cityRef?.setSpeed(v); };
  client.onResult = (ok, reason) => { lastResult = ok ? 'Стартовий сектор підтверджено!' : REASONS[reason ?? 'invalid'] ?? 'Відмова'; onSession(); if (ok) enterCityNow(); };
  onSession();
}
let lastResult = '';
/** Швидкість гри: керує хост (або соло), клієнти отримують її повідомленням. */
let gameSpeed = 1;
let cityRef: { setSpeed(v: number): void } | null = null;
let enterCityNow: () => void = () => {};

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
    ? (claim.ok ? '<em>Клік — примірити цей сектор</em>' : `<em class="bad">${REASONS[claim.reason]}</em>`) : '';
  tip.innerHTML = `<h3>Сектор ${s.hex.q},${s.hex.r}</h3><div>${owner}</div>${rows}${hint}`;
  tip.style.display = 'block';
  tip.style.left = `${Math.min(x + 16, window.innerWidth - tip.offsetWidth - 8)}px`;
  tip.style.top = `${Math.min(y + 16, window.innerHeight - tip.offsetHeight - 8)}px`;
};

// Клік лише «примірює» сектор (можна міняти скільки завгодно); підтверджує кнопка «Грати».
let selected: number | null = null;
const playBtn = $<HTMLButtonElement>('play');
const refreshPlay = () => {
  const mine = myPlayer();
  const need = mine?.homeSector === null;
  playBtn.style.display = need ? '' : 'none';
  if (!need) { selected = null; view.selectedId = null; return; }
  const c = selected === null ? null : canClaimStart(state, me, selected);
  playBtn.disabled = !c || !c.ok;
  view.selectedId = selected;
  status.textContent = selected === null ? 'Обери сектор (можна міняти вибір) і натисни «Грати»'
    : c && c.ok ? `Сектор ${state.sectors[selected].hex.q},${state.sectors[selected].hex.r}: натисни «Грати»`
    : `Цей сектор не підходить: ${REASONS[(c as { reason: string }).reason]}. Обери інший`;
};
view.onClick = (id) => {
  if (myPlayer()?.homeSector !== null) return;
  selected = id;
  refreshPlay();
  view.redraw();
};
playBtn.onclick = () => {
  if (selected === null) return;
  const id = selected;
  if (netRole === 'client') {
    const c = canClaimStart(state, me, id);
    if (!c.ok) { refreshPlay(); return; }
    status.textContent = 'Надсилаю хосту…';
    playBtn.disabled = true;
    client!.claim(id);
    return;
  }
  const r = host ? host.claim(me, id) : claimStart(state, me, id);
  if (!r.ok) { refreshPlay(); view.redraw(); return; }
  view.redraw();
  onSession();
  enterCityNow();
};

function placeBot(): void {
  const rnd = mulberry32(state.world.seed ^ 0xb07);
  const ids = state.sectors.map((s) => s.id).sort(() => rnd() - 0.5);
  const id = ids.find((i) => canClaimStart(state, 'bot1', i).ok);
  if (id !== undefined) claimStart(state, 'bot1', id);
}

// Місто домашнього сектора. Поки кожен гравець симулює своє місто локально (синхронізація економіки — пізніше).
let city: CityView | null = null;
const cityBtn = $<HTMLButtonElement>('enterCity');
const exitCity = () => { city?.destroy(); city = null; cityRef = null; view.world.visible = true; $('hud').style.display = ''; saveUi.refresh(); };
enterCityNow = () => {
  const home = myPlayer()?.homeSector;
  if (home === null || home === undefined || city) return;
  if (!sim) {
    // Клієнтський знімок містить заглушку npcs без масивів: прибираємо, щоб sim створив власні.
    if (netRole === 'client') delete (state as { npcs?: unknown }).npcs;
    sim = wrapState(state as never);
    startCity(sim, me);
  }
  view.world.visible = false; tip.style.display = 'none'; $('hud').style.display = 'none';
  saveUi.refresh();
  city = new CityView(app, sim, me, home, exitCity, {
    locked: netRole === 'client', speed: gameSpeed,
    onSpeed: (v) => { gameSpeed = v; host?.setSpeed(v); },
  });
  cityRef = city;
  (window as unknown as { __city?: CityView }).__city = city;
};
cityBtn.onclick = () => enterCityNow();

onSession = () => {
  const mine = myPlayer();
  cityBtn.style.display = mine?.homeSector != null ? '' : 'none';
  refreshPlay();
  if (lastResult) { status.textContent = lastResult; lastResult = ''; }
  else if (mine && mine.homeSector !== null) status.textContent = 'Сектор обрано. Гра йде у твоєму місті';
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
  selected = null;
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

// Збереження: автосейв в IndexedDB за таймером, кнопка «Збереження» (файл/завантаження). Зберігає лише хост.
const ctl = new SaveController({ world: () => sim, speed: () => gameSpeed, canSave: () => netRole !== 'client' });
const loadFromFile = async () => {
  const g: LoadedGame | null = await ctl.importFile();
  if (!g) return;
  if (netRole === 'client') throw new Error('Завантажує лише хост гри');
  if (!g.world.state.players.some((p) => p.id === me)) throw new Error('Цей сейв від іншої гри (інші гравці). Онови сторінку й завантаж його з головного меню.');
  exitCity();
  Object.assign(state, g.world.state); // та сама адреса: на неї дивляться карта й сесія хоста
  g.world.state = state as never;
  sim = g.world;
  gameSpeed = g.speed;
  host?.setSpeed(gameSpeed);
  onSession();
  enterCityNow();
};
const saveUi = mountSaveMenu(ctl, { onLoad: loadFromFile, visible: () => netRole !== 'client' && !!sim && sim.state.buildings.length > 0 });
ctl.start();
(window as unknown as { __game?: unknown }).__game = { ctl, get sim() { return sim; }, get state() { return state; }, get speed() { return gameSpeed; } };

reset();
onSession();
graphicsReady = true;
if (autoEnter) { autoEnter = false; enterCityNow(); }
app.renderer.on('resize', () => view.redraw());
} catch (e) { showError('карта', e); }
}
void startGraphics();
