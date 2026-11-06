import type { SimWorld } from '../sim';
import { AUTOSAVE_INTERVAL_MS } from './config';
import { loadGame, SaveError, type LoadedGame } from './saveFile';
import { autosave, autosaveInfo, loadAutosave, pickSaveFile, saveToFile, type SaveInfo } from './storage';

export interface SaveHost {
  /** Поточний світ (null — гра ще не почалась). */
  world(): SimWorld | null;
  speed(): number;
  /** Зберігає лише хост (або соло); гість — ні. */
  canSave(): boolean;
}

export interface SaveStatus { text: string; error: boolean }

/** Автосейв за таймером + ручне збереження/завантаження. Помилки не ковтає: віддає в onStatus. */
export class SaveController {
  onStatus: (s: SaveStatus) => void = () => {};
  last: SaveInfo | null = null;
  private busy = false;
  private lastTick = -1;
  private timer = 0;

  constructor(private host: SaveHost, private intervalMs = AUTOSAVE_INTERVAL_MS) {}

  start(): void {
    this.stop();
    void autosaveInfo().then((i) => { if (i && !this.last) this.last = i; });
    this.timer = window.setInterval(() => void this.auto(), this.intervalMs);
    document.addEventListener('visibilitychange', this.onVis);
  }
  stop(): void { window.clearInterval(this.timer); document.removeEventListener('visibilitychange', this.onVis); }
  private onVis = () => { if (document.visibilityState === 'hidden') void this.auto(); };

  private say(text: string, error = false): void { this.onStatus({ text, error }); }

  /** Автосейв, якщо є що зберігати (місто є, час пішов). */
  async auto(): Promise<void> { await this.saveAuto(false); }

  /** Зберегти в автозбереження зараз (кнопка). */
  async saveNow(): Promise<boolean> { return this.saveAuto(true); }

  private async saveAuto(manual: boolean): Promise<boolean> {
    const w = this.host.world();
    if (this.busy || !w || !this.host.canSave() || !w.state.buildings.length) {
      if (manual) this.say(this.host.canSave() ? 'Нічого зберігати: місто ще не засноване' : 'Зберігає лише хост гри', true);
      return false;
    }
    if (!manual && w.state.tick === this.lastTick) return false;
    this.busy = true;
    try {
      const r = await autosave(w, this.host.speed());
      if (r.ok) { this.last = r.info; this.lastTick = r.info.tick; this.say(`${manual ? 'Збережено' : 'Автозбереження'} о ${new Date(r.info.savedAt).toLocaleTimeString('uk-UA')}`); return true; }
      this.say(r.error, true);
      return false;
    } finally { this.busy = false; }
  }

  /** Експорт у .save файл. */
  async exportFile(): Promise<boolean> {
    const w = this.host.world();
    if (!w || !this.host.canSave() || !w.state.buildings.length) { this.say(this.host.canSave() ? 'Нічого зберігати: місто ще не засноване' : 'Зберігає лише хост гри', true); return false; }
    if (this.busy) return false;
    this.busy = true;
    try {
      const ok = await saveToFile(w, this.host.speed());
      if (ok) this.say('Збережено у файл');
      return ok;
    } catch (e) { this.say(`Не вдалося зберегти файл: ${e instanceof Error ? e.message : e}`, true); return false; }
    finally { this.busy = false; }
  }

  /** Імпорт із файлу. null — скасовано або помилка (вона в статусі). */
  async importFile(): Promise<LoadedGame | null> {
    try {
      const save = await pickSaveFile();
      if (!save) return null;
      return loadGame(save);
    } catch (e) { this.say(e instanceof SaveError ? e.message : `Не вдалося прочитати сейв: ${e instanceof Error ? e.message : e}`, true); return null; }
  }

  /** Завантажити автозбереження (для «Продовжити»). Помилка — у статусі й у винятку. */
  async loadAuto(): Promise<LoadedGame | null> {
    const save = await loadAutosave();
    return save ? loadGame(save) : null;
  }
}
