import { Application } from 'pixi.js';
import type { PlayerState } from './shared';
import { MIN_START_DISTANCE, RESOURCE_KINDS } from './shared';
import { MapView, RESOURCE_COLORS, RESOURCE_NAMES } from './render/mapView';
import { canClaimStart, claimStart, createInitialState, DEFAULT_WORLD_RADIUS, SECTOR_RESOURCES } from './sim/worldgen';
import { mulberry32 } from './sim/rng';
import { mountLobby } from './ui';

const ME = 'me';
const REASONS: Record<string, string> = {
  occupied: 'Сектор зайнятий', too_close_to_start: 'Надто близько до чужого старту', invalid: 'Старт уже обрано',
};

const mkPlayer = (id: string, nickname: string, color: number): PlayerState => ({
  id, nickname, token: id, color, homeSector: null, ownedSectors: [],
  resources: Object.fromEntries(RESOURCE_KINDS.map((k) => [k, 0])) as PlayerState['resources'],
});

let minDist = MIN_START_DISTANCE;
let state = newWorld(Math.floor(Math.random() * 1e9));

function newWorld(seed: number) {
  return createInitialState(seed, DEFAULT_WORLD_RADIUS, minDist, [
    mkPlayer(ME, 'Ти', 0x4fc3f7), mkPlayer('bot1', 'Суперник', 0xff7043),
  ]);
}

const lobby = mountLobby({ onHostStart: () => lobby.destroy(), onJoined: () => lobby.destroy() });
const statusEl = document.getElementById('status')!;
const app = new Application();
try {
  await app.init({ resizeTo: window, background: '#1a1420', antialias: true, preference: 'webgl' });
} catch (e) {
  statusEl.textContent = 'Не вдалося запустити графіку (WebGL): ' + (e instanceof Error ? e.message : String(e));
  statusEl.style.color = '#f66';
  throw e;
}
document.getElementById('app')!.appendChild(app.canvas);

const view = new MapView(app, () => state);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const tip = $('tip'), status = $('status');

view.blocked = (id) => !canClaimStart(state, ME, id).ok;

view.onHover = (id, x, y) => {
  if (id === null) { tip.style.display = 'none'; return; }
  const s = state.sectors[id];
  const rows = SECTOR_RESOURCES.map(({ kind }) => {
    const v = s.richness[kind] ?? 0;
    return `<div class="row"><i style="background:#${RESOURCE_COLORS[kind].toString(16).padStart(6, '0')}"></i>` +
      `<span>${RESOURCE_NAMES[kind]}</span><b>${Math.round(v * 100)}%</b></div>`;
  }).join('');
  const owner = s.owner ? state.players.find((p) => p.id === s.owner)!.nickname : 'вільний';
  const claim = canClaimStart(state, ME, id);
  const hint = state.players[0].homeSector === null
    ? (claim.ok ? '<em>Клік — обрати стартом</em>' : `<em class="bad">${REASONS[claim.reason]}</em>`) : '';
  tip.innerHTML = `<h3>Сектор ${s.hex.q},${s.hex.r}</h3><div>${owner}</div>${rows}${hint}`;
  tip.style.display = 'block';
  tip.style.left = `${Math.min(x + 16, window.innerWidth - tip.offsetWidth - 8)}px`;
  tip.style.top = `${Math.min(y + 16, window.innerHeight - tip.offsetHeight - 8)}px`;
};

view.onClick = (id) => {
  const r = claimStart(state, ME, id);
  status.textContent = r.ok ? 'Стартовий сектор обрано!' : REASONS[r.reason];
  view.redraw();
};

function placeBot(): void {
  const rnd = mulberry32(state.world.seed ^ 0xb07);
  const ids = state.sectors.map((s) => s.id).sort(() => rnd() - 0.5);
  const id = ids.find((i) => canClaimStart(state, 'bot1', i).ok);
  if (id !== undefined) claimStart(state, 'bot1', id);
}

function reset(): void {
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
app.renderer.on('resize', () => view.redraw());


