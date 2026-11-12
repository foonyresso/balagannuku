import { Container, Graphics, type Application } from 'pixi.js';
import type { BuildingKind } from '../../shared';
import { SECTOR_SIZE } from '../../shared';
import { checkPlace, stepWorld, type SimWorld } from '../../sim';
import { FOOTPRINT } from '../../sim/balance';
import { CityHud } from '../../ui/cityHud';
import type { Sel } from '../../ui/info';
import { TickPacer, isSpeed } from '../../ui/pacer';
import { TickClock } from '../interp';
import { planeToIso } from '../projection';
import { Atmosphere, Particles, initStyle } from '../style';
import { anchor, hudHooks, send, type Cmd } from './actions';
import { BuildingGhost } from './buildingGhost';
import { BubbleLayer } from './bubbles';
import { applyCam, followPos } from './camera';
import { makeFog } from './fog';
import { drawFrame } from './frames';
import { emitSmoke } from './fx';
import { CityInput } from './input';
import { DepthLayers } from './layers';
import { NpcLayer } from './npcs';
import { npcXY, posOf } from './picking';
import { Roads } from './roads';
import { FOLLOW_ZOOM, NB, TILE, rowOf, type CityApi, type Scene, type Ui } from './scene';
import { Surroundings } from './surroundings';
import { Water } from './water';

/**
 * Вигляд міста одного сектора в тій самій ізометрії, що й карта. Тут лише збирання частин і цикл кадру:
 * порядок шарів, симуляція, виклик малювання. Кожна частина — у своєму файлі цього каталогу (карта в CLAUDE.md).
 */
export class CityView implements CityApi {
  readonly scene: Scene;
  readonly ui: Ui = { build: null, sel: null, hoverSel: null, hover: null, following: false, targetZoom: 1, speed: 1, resumeSpeed: 1 };
  readonly hud: CityHud;
  private parts = new Particles();
  private roads = new Roads();
  private water: Water;
  private layers = new DepthLayers();
  private npcs = new NpcLayer();
  private bubbles = new BubbleLayer();
  private hoverG = new Graphics();
  private ghost = new BuildingGhost();
  private surroundings: Surroundings;
  private input: CityInput;
  private pacer = new TickPacer();
  private frame = 0;

  constructor(app: Application, w: SimWorld, player: string, sector: number, private onExit: () => void,
    private net: { locked?: boolean; speed?: number; onSpeed?: (s: number) => void } = {}) {
    if (isSpeed(net.speed)) this.ui.speed = net.speed;
    initStyle(TILE);
    // Сусідні сектори (ландшафт): ряд над домашнім і по боках — під землею, ряд під ним — поверх шарів.
    this.surroundings = new Surroundings(app.renderer, w.state.world.seed, w.state.sectors[sector]);
    const bb = Surroundings.bounds(), mid0 = planeToIso((bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2);
    const atmo = new Atmosphere(mid0, (bb.maxX - bb.minX) * 0.25, { minX: bb.minX, maxX: bb.maxX });
    const root = new Container(), rowCont: Container[] = [];
    const scene: Scene = this.scene = {
      app, w, player, sector, root, rowCont, rows: Array.from({ length: NB }, () => []),
      cam: { zoom: 1, x: 0, y: 0 }, atmo, parts: this.parts, clock: new TickClock(), animT: 0,
    };
    // Порядок шарів знизу вгору: оточення, дороги, вода, блиск, поля, шари глибини, ліски, передній план, туман, атмосфера, частинки, рамки.
    root.addChild(this.surroundings.back);
    root.addChild(this.roads.g);
    this.water = new Water(scene);
    root.addChild(this.water.g);
    root.addChild(this.water.shine);
    root.addChild(this.layers.fieldLayer);
    for (let r = 0; r < NB; r++) {
      const c = new Container();
      c.sortableChildren = true;
      rowCont.push(c);
      root.addChild(c);
    }
    root.addChild(this.npcs.fishG);
    root.addChild(this.surroundings.front);
    root.addChild(makeFog());
    root.addChild(atmo.world, this.parts.layer);
    root.addChild(this.hoverG);
    app.stage.addChild(root, atmo.multiply, atmo.lights, atmo.top, this.bubbles.layer);
    atmo.resize(app.screen.width, app.screen.height);
    app.renderer.on('resize', this.onResize);
    const mid = planeToIso((SECTOR_SIZE * TILE) / 2, (SECTOR_SIZE * TILE) / 2);
    scene.cam = { zoom: 1, x: app.screen.width / 2 - mid.x, y: app.screen.height / 2 - mid.y };
    applyCam(scene);
    this.hud = new CityHud(hudHooks(this), w, player, sector);
    this.input = new CityInput(this);
    app.ticker.add(this.draw);
    this.rebuild();
    this.refreshHud();
  }

  private onResize = (): void => this.scene.atmo.resize(this.scene.app.screen.width, this.scene.app.screen.height);

  // --- стан керування

  setBuild(k: BuildingKind | null): void {
    this.ui.build = k;
    if (k) { this.ui.sel = null; this.ui.following = false; }
    this.refreshHud();
  }
  select(sel: Sel, follow: boolean): void {
    this.ui.build = null;
    this.ui.sel = sel;
    this.setFollow(follow);
  }
  deselect(): void {
    this.ui.sel = null; this.ui.following = false;
    this.refreshHud();
  }
  setFollow(on: boolean): void {
    this.ui.following = on && !!this.ui.sel;
    if (this.ui.following) this.ui.targetZoom = Math.max(this.scene.cam.zoom, FOLLOW_ZOOM);
    this.refreshHud();
  }
  refreshHud(): void {
    const ui = this.ui;
    this.hud.update({ selected: ui.sel, build: ui.build, following: ui.following, speed: ui.speed, actualSpeed: this.pacer.actual, speedLocked: !!this.net.locked });
  }
  exit(): void { this.onExit(); }

  /** Гравець змінив швидкість (кнопка/клавіша); у мережевій грі гість не керує — лише хост. */
  userSpeed(v: number): void {
    if (this.net.locked || !isSpeed(v)) return;
    this.setSpeed(v);
    this.net.onSpeed?.(v);
  }
  /** Застосувати швидкість (також ззовні: хост змінив). */
  setSpeed(v: number): void {
    if (!isSpeed(v)) return;
    if (v > 0) this.ui.resumeSpeed = v;
    this.ui.speed = v;
    this.refreshHud();
  }

  // --- кадр

  /** Перебудувати шари об'єктів; дороги перемальовуються, лише якщо їхні стадії змінились (або roads = true). */
  rebuild(roads = false): void {
    if (roads) this.roads.dirty = true;
    this.roads.redrawIfDirty(this.scene);
    this.layers.rebuild(this.scene);
  }

  /** Кадр симуляції: стільки тіків, скільки належить швидкості, у межах бюджету часу кадру. */
  private simulate(): void {
    const { w, app, clock } = this.scene;
    this.pacer.advance(app.ticker.deltaMS, this.ui.speed, () => {
      stepWorld(w);
      clock.tick(performance.now());
      if (w.events.some((e) => e.e === 'trail_stage_changed')) this.roads.dirty = true;
    });
  }

  /** Виділеного вже немає — зняти виділення; увімкнене стеження веде камеру за ним. */
  private followCam(): void {
    const ui = this.ui;
    if (!ui.sel) return;
    const pos = posOf(this.scene, ui.sel);
    if (!pos) { this.deselect(); return; }
    if (ui.following) followPos(this.scene, ui, pos);
  }

  private draw = (): void => {
    const s = this.scene, ui = this.ui;
    this.simulate();
    this.surroundings.update(s.cam, s.app.screen.width, s.app.screen.height);
    this.layers.cull(s);
    const dt = Math.min(0.05, s.app.ticker.deltaMS / 1000);
    if (ui.speed > 0) s.animT += dt;
    this.npcs.draw(s, dt);
    this.bubbles.update(s, this.npcs, dt);
    s.atmo.update(dt);
    s.parts.update(dt);
    emitSmoke(s, this.layers.smokers, dt);
    this.water.drawShine(s);
    this.followCam();
    this.hoverG.clear();
    if (!(ui.build && ui.hover)) this.ghost.hide();
    if (ui.build && ui.hover) {
      const t = anchor(ui.build, ui.hover), fp = FOOTPRINT[ui.build];
      const ok = !fp || checkPlace(s.w, s.sector, ui.build, t.x, t.y) === null;
      if (fp) {
        const bk = rowOf(t.y + fp.h - 1);
        this.ghost.show(s.root, this.roads.g, s.rowCont[bk], bk, t, fp, TILE, ui.build, ok);
      }
    }
    if (ui.hoverSel && !(ui.sel && JSON.stringify(ui.sel) === JSON.stringify(ui.hoverSel))) drawFrame(s, this.hoverG, ui.hoverSel, 0xffffff, 0.5);
    if (ui.sel) drawFrame(s, this.hoverG, ui.sel, 0xffd54f, 1);
    if (++this.frame % 20 === 0) {
      if (this.layers.changed(s)) this.rebuild();
      this.refreshHud();
    }
  };

  /** Для автотестів: команда від імені гравця цього міста. */
  cmd(cmd: Cmd) { return send(this, cmd); }

  /** Для автотестів: стан вибору й екранні координати об'єктів. */
  debugState(): { build: BuildingKind | null; sel: Sel | null; following: boolean; ghost: boolean; layers: { ground: number; base: number; ghost: number; hover: number }; speed: number; tick: number; zoom: number; npcs: { id: number; sx: number; sy: number }[]; time: string; lights: number; particles: number; npcSprites: number; bubbles: { texts: number; emotes: number }; buildings: { id: number; kind: string; sx: number; sy: number }[] } {
    const s = this.scene, ui = this.ui, { root, cam, w } = s;
    const scr = (x: number, y: number, z: number) => { const i = planeToIso(x * TILE, y * TILE, z); return { sx: i.x * cam.zoom + cam.x, sy: i.y * cam.zoom + cam.y }; };
    const n = w.state.npcs, npcs: { id: number; sx: number; sy: number }[] = [];
    for (let i = 0; i < n.capacity; i++) if (n.alive[i] && n.sector[i] === s.sector) npcs.push({ id: i, ...scr(npcXY(s, i).x, npcXY(s, i).y, 3) });
    const buildings = w.state.buildings.map((b) => ({ id: b.id, kind: b.kind, ...scr(b.cell.x + b.size.w / 2, b.cell.y + b.size.h / 2, 6) }));
    return { build: ui.build, sel: ui.sel, following: ui.following, ghost: this.ghost.g.visible && !!this.ghost.g.parent,
      layers: { ground: root.getChildIndex(this.roads.g), base: this.ghost.base.parent ? root.getChildIndex(this.ghost.base) : -1, ghost: this.ghost.g.parent ? root.getChildIndex(this.ghost.g) : -1, hover: root.getChildIndex(this.hoverG) },
      speed: ui.speed, tick: w.state.tick, zoom: cam.zoom, npcs, time: s.atmo.key, lights: s.atmo.lightCount, particles: s.parts.count, npcSprites: this.npcs.count, bubbles: this.bubbles.kinds, buildings };
  }

  destroy(): void {
    const { app, atmo, root } = this.scene;
    app.ticker.remove(this.draw);
    this.input.destroy();
    app.renderer.off('resize', this.onResize);
    app.stage.removeChild(root, atmo.multiply, atmo.lights, atmo.top);
    this.bubbles.destroy();
    atmo.multiply.destroy(); atmo.lights.destroy({ children: true }); atmo.top.destroy({ children: true });
    root.destroy({ children: true });
    this.hud.destroy();
  }
}
