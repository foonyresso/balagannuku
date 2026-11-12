import { Container, type Sprite } from 'pixi.js';
import { SECTOR_CELLS } from '../../shared';
import { getSectorRt } from '../../sim';
import { ISO_Y, screenToPlane } from '../projection';
import { buildingObjs, type Smoker } from './buildings';
import { nodeObj } from './nodes';
import { BUCKET, NB, TILE, type Obj, type Scene } from './scene';

/**
 * Об'єкти (дерева, камінь, будівлі) по шарах глибини. Інкрементально: на великій карті (десятки тисяч вузлів)
 * перебудовуємо лише ті шари, де щось змінилось (зрубане дерево, нова будівля).
 */
export class DepthLayers {
  /** Плоскі поля ферм: під об'єктами, щоб фермери на полі не ховались за спрайтом. */
  readonly fieldLayer = new Container();
  /** Джерела диму поточних споруд. */
  smokers: Smoker[] = [];
  private nodeSpr: (Sprite[] | undefined)[] = [];
  private bldSpr: Sprite[] = [];
  private nodeRows: Obj[][] = Array.from({ length: NB }, () => []);
  private bldRows: Obj[][] = Array.from({ length: NB }, () => []);
  /** Підпис кожного рядка клітинок вузлів (зрубано/виросло): перемальовуємо лише змінені шари глибини. */
  private rowSig: Int32Array = new Int32Array(SECTOR_CELLS).fill(-1);
  private bldSig = '';
  private lastSig = '';

  /** Видимий стан змінився з останньої перебудови (дешева перевірка раз на кілька кадрів). */
  changed(scene: Scene): boolean { return this.signature(scene) !== this.lastSig; }

  rebuild(scene: Scene): void {
    const rt = getSectorRt(scene.w, scene.sector), seed = scene.w.state.world.seed;
    this.lastSig = this.signature(scene);
    const dirty = new Set<number>();
    for (let cy = 0; cy < SECTOR_CELLS; cy++) {
      let h = 0;
      for (let cx = 0, i = cy * SECTOR_CELLS; cx < SECTOR_CELLS; cx++, i++) if (rt.kind[i]) h = (Math.imul(h, 31) + (rt.amount[i] > 0 ? i + 1 : -(i + 1))) | 0;
      if (h === this.rowSig[cy]) continue;
      this.rowSig[cy] = h;
      for (const sp of this.nodeSpr[cy] ?? []) sp.destroy();
      const objs: Obj[] = [];
      for (let cx = 0; cx < SECTOR_CELLS; cx++) { const n = nodeObj(rt, seed, scene.sector, cx, cy); if (n) objs.push(n.obj); }
      this.nodeRows[cy] = objs;
      const sprites = objs.flatMap((o) => o.sprites);
      for (const sp of sprites) scene.rowCont[cy].addChild(sp);
      this.nodeSpr[cy] = sprites;
      dirty.add(cy);
    }
    const bsig = rt.buildings.map((b) => b.id).join(',');
    if (bsig !== this.bldSig) {
      this.bldSig = bsig;
      for (const sp of this.bldSpr) sp.destroy();
      this.bldSpr = [];
      for (let r = 0; r < NB; r++) if (this.bldRows[r].length) { dirty.add(r); this.bldRows[r] = []; }
      const built = buildingObjs(scene, rt);
      this.smokers = built.smokers;
      for (const fs of built.flat) { this.fieldLayer.addChild(fs); this.bldSpr.push(fs); }
      for (const { row, obj } of built.objs) {
        this.bldRows[row].push(obj); dirty.add(row);
        for (const sp of obj.sprites) { scene.rowCont[row].addChild(sp); this.bldSpr.push(sp); }
      }
    }
    for (const r of dirty) scene.rows[r] = [...this.nodeRows[r], ...this.bldRows[r]];
  }

  /** Відсікання: шари глибини (смуги по y), що не потрапляють у видиму область екрана, не малюються. */
  cull(scene: Scene): void {
    const top = screenToPlane(0, 0, scene.cam).y, bot = screenToPlane(0, scene.app.screen.height, scene.cam).y;
    const margin = 70 / ISO_Y; // висота дерев і будівель зсуває малюнок угору
    const y0 = top - margin, y1 = bot + margin, rowH = BUCKET * TILE;
    for (let r = 0; r < NB; r++) scene.rowCont[r].visible = (r + 1) * rowH >= y0 && r * rowH <= y1;
  }

  /** Дешева сигнатура видимого стану (вузли зрубано/виросло, кількість будівель): без змін — шари не перебудовуємо. */
  private signature(scene: Scene): string {
    const rt = getSectorRt(scene.w, scene.sector);
    let h = 0, grown = 0;
    for (let i = 0; i < rt.kind.length; i++) if (rt.kind[i] && rt.amount[i] > 0) { grown++; h = (h * 31 + i) | 0; }
    return `${grown}:${h}:${rt.buildings.length}`;
  }
}
