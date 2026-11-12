import type { ResourceKind } from '../../shared';
import { RESOURCE_KINDS } from '../../shared';
import { isStorage } from '../stock';
import type { SimWorld } from '../world';

/** Підсумок запасів гравців = сума запасів його сховищ. */
export function syncPlayerResources(w: SimWorld): void {
  for (const p of w.state.players) for (const k of RESOURCE_KINDS) p.resources[k] = 0;
  for (const b of w.state.buildings) {
    if (!isStorage(b)) continue;
    const p = w.state.players.find((x) => x.id === b.owner);
    if (p) for (const [k, v] of Object.entries(b.stock)) p.resources[k as ResourceKind] += v ?? 0;
  }
}
