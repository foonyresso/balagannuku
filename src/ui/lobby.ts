import type { LobbyPlayer } from '../shared';
import type { GameState } from '../shared';
import { loadState, pickSaveFile } from '../persist';
import { ClientLobby, HostLobby, type JoinResult, connectToRoom, isValidRoomCode, normalizeRoomCode, openRoom } from '../net';

const CSS = `
.lb{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#1a1420;z-index:10;font-family:sans-serif;color:#eee}
.lb-box{width:340px;display:flex;flex-direction:column;gap:10px;zoom:var(--ui-scale,1)}
.lb h2{margin:0 0 4px;text-align:center}
.lb input,.lb button{font:inherit;padding:8px 10px;border-radius:6px;border:1px solid #5a4a6a;background:#2a2036;color:#eee}
.lb button{cursor:pointer;background:#e0a030;color:#1a1420;border:0;font-weight:bold}
.lb button:disabled{opacity:.5;cursor:default}.lb button.sec{background:#3a2e48;color:#eee}
.lb .code{font-size:32px;letter-spacing:6px;text-align:center;user-select:all}
.lb .err{color:#f66;min-height:1.2em}.lb ul{margin:0;padding-left:18px}
.lb-scale{position:fixed;right:12px;bottom:12px;z-index:11;color:#aaa;font:12px sans-serif}
`;

export interface LobbyHandle { destroy(): void }
export interface LobbyCallbacks {
  /** Хост натиснув «Почати»: лобі й список гравців. */
  /** loaded — стан із сейва («Продовжити»), інакше нова гра. */
  onHostStart?: (lobby: HostLobby, loaded?: GameState) => void;
  onJoined?: (client: ClientLobby, res: Extract<JoinResult, { ok: true }>) => void;
}

export function mountLobby(cb: LobbyCallbacks = {}): LobbyHandle {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.className = 'lb';
  document.body.appendChild(root);

  const scale = document.createElement('label');
  scale.className = 'lb-scale';
  scale.innerHTML = 'Масштаб UI <input type="range" min="0.7" max="2" step="0.1">';
  const range = scale.querySelector('input')!;
  const saved = (() => { try { return localStorage.getItem('balagannuku.uiScale'); } catch { return null; } })();
  range.value = saved ?? '1';
  const applyScale = () => {
    document.documentElement.style.setProperty('--ui-scale', range.value);
    try { localStorage.setItem('balagannuku.uiScale', range.value); } catch { /* ignore */ }
  };
  range.oninput = applyScale;
  applyScale();
  document.body.appendChild(scale);

  const nick = () => (localStorage.getItem('balagannuku.nick') || '');
  const setBox = (html: string) => { root.innerHTML = `<div class="lb-box">${html}</div>`; return root.querySelector('.lb-box') as HTMLElement; };
  const q = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const list = (ps: LobbyPlayer[]) => ps.map((p) => `<li>${esc(p.nickname)}${p.isHost ? ' ★' : ''}${p.online ? '' : ' (офлайн)'}</li>`).join('');

  const menu = () => {
    setBox(`<h2>Балаганники</h2>
      <input id="nick" placeholder="Нікнейм" maxlength="20" value="${esc(nick())}">
      <button id="new">Нова гра</button>
      <input id="code" placeholder="Код кімнати" maxlength="5" style="text-transform:uppercase">
      <button id="join" class="sec">Приєднатися за кодом</button>
      <button id="cont" class="sec">Продовжити з сейва</button>
      <div class="err" id="err"></div>`);
    // Якщо екран уже замінено (напр., після входу в кімнату), повертаємось у меню, щоб показати помилку.
    const err = (m: string) => {
      let el = root.querySelector('#err');
      if (!el) { menu(); el = root.querySelector('#err'); }
      if (el) el.textContent = m;
    };
    const name = () => { const n = q<HTMLInputElement>('#nick').value.trim() || 'Гравець'; try { localStorage.setItem('balagannuku.nick', n); } catch { /* ignore */ } return n; };
    q('#new').onclick = async () => {
      err('Створюю кімнату…');
      try {
        let lobby!: HostLobby;
        const { code } = await openRoom((c) => lobby.accept(c));
        lobby = new HostLobby(code, name());
        hostView(lobby);
      } catch { err('Не вдалося створити кімнату (немає зв’язку з сервером).'); }
    };
    q('#cont').onclick = async () => {
      try {
        const save = await pickSaveFile();
        if (!save) return;
        const loaded = loadState(save);
        if (!loaded.players.length) return err('У сейві немає гравців.');
        err('Створюю кімнату…');
        let lobby!: HostLobby;
        const { code } = await openRoom((c) => lobby.accept(c));
        lobby = HostLobby.fromPlayers(code, loaded.players);
        hostView(lobby, loaded);
      } catch (e) { err(e instanceof Error ? e.message : 'Не вдалося прочитати сейв.'); }
    };
    q('#join').onclick = async () => {
      const code = normalizeRoomCode(q<HTMLInputElement>('#code').value);
      if (!isValidRoomCode(code)) return err('Невірний код кімнати.');
      err('Підключаюся…');
      try {
        const { conn } = await connectToRoom(code);
        const client = new ClientLobby(conn);
        client.onLobby = (ps) => { setBox(`<h2>Кімната ${code}</h2><ul>${list(ps)}</ul><div>Чекаємо старту від хоста…</div>`); };
        const res = await client.join(code, name());
        if (res.ok) cb.onJoined?.(client, res);
        else { client.close(); err(REASONS[res.reason] ?? 'Помилка входу.'); }
      } catch { err('Кімнату не знайдено або немає зв’язку.'); }
    };
  };

  const hostView = (lobby: HostLobby, loaded?: GameState) => {
    setBox(`<h2>Ваша кімната</h2><div class="code">${lobby.roomCode}</div>
      <div>Поділіться кодом з друзями.</div><ul id="pl">${list(lobby.players())}</ul>
      <button id="start">Почати</button>`);
    lobby.onChange = (ps) => { q('#pl').innerHTML = list(ps); };
    q('#start').onclick = () => cb.onHostStart?.(lobby, loaded);
  };

  menu();
  return { destroy: () => { root.remove(); scale.remove(); style.remove(); } };
}

const REASONS: Record<string, string> = {
  bad_code: 'Невірний код кімнати.', room_full: 'Кімната заповнена.',
  protocol_mismatch: 'Різні версії гри.', token_conflict: 'Цей гравець уже підключений.',
  connection_lost: 'З’єднання втрачено.',
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
