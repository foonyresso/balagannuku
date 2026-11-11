/** Рибальство (лише вигляд): де вода поруч із рибалкою і де лежить поплавок. */

export interface WaterTarget { x: number; y: number }

/** Найближчий тайл води в радіусі r (центр тайла, в одиницях тайлів) або null. */
export function nearestWater(isWater: (x: number, y: number) => boolean, tx: number, ty: number, r = 5): WaterTarget | null {
  const cx = Math.floor(tx), cy = Math.floor(ty);
  let best: WaterTarget | null = null, bd = Infinity;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (!isWater(x, y)) continue;
      const d = (x + 0.5 - tx) ** 2 + (y + 0.5 - ty) ** 2;
      if (d < bd) { bd = d; best = { x: x + 0.5, y: y + 0.5 }; }
    }
  }
  return best;
}

/**
 * Поплавок: на воді в напрямку води (мінімум 1.5 тайла від рибалки, щоб не лежав під ногами),
 * з легким хитанням t (с). Повертає тайлові координати і висоту z (у тайлах) над водою.
 */
export function bobberAt(from: { x: number; y: number }, water: WaterTarget, t: number): { x: number; y: number; z: number } {
  const dx = water.x - from.x, dy = water.y - from.y, d = Math.hypot(dx, dy) || 1;
  const reach = Math.max(d, 1.5);
  return { x: from.x + (dx / d) * reach, y: from.y + (dy / d) * reach + Math.sin(t * 2.2) * 0.04, z: Math.sin(t * 3.1) * 0.12 };
}
