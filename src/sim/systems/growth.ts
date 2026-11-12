import { STONE_AMOUNT, TREE_AMOUNT, TREE_REGROW_INTERVAL } from '../balance';
import { NODE_TREE, type SimWorld } from '../world';

/** Відновлення вузлів ресурсів: зрубане дерево й розбитий камінь повертаються (ресурс безкінечний, це лише вигляд). */
export function growthTick(w: SimWorld): void {
  if (w.state.tick % TREE_REGROW_INTERVAL !== 0) return;
  for (const rt of w.sectors.values()) {
    for (let c = 0; c < rt.kind.length; c++) {
      if (rt.kind[c] && rt.amount[c] === 0) {
        rt.amount[c] = rt.kind[c] === NODE_TREE ? TREE_AMOUNT : STONE_AMOUNT;
        if (rt.kind[c] === NODE_TREE) rt.forest[c] = 1;
      }
    }
  }
}
