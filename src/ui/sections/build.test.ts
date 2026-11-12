import { describe, expect, it } from 'vitest';
import { BUILD_NAMES } from '../info';
import { BUILD_TABS, tabOfBuilding } from './build';
import type { BuildingKind } from '../../shared';

describe('вкладки будівництва', () => {
  it('кожна споруда (крім ратуші) потрапляє рівно в одну вкладку, невідома — в «Ресурси»', () => {
    for (const k of Object.keys(BUILD_NAMES) as BuildingKind[]) {
      if (k === 'townhall') continue;
      expect(BUILD_TABS.filter((t) => t.kinds.includes(k)).length, k).toBeLessThanOrEqual(1);
      expect(BUILD_TABS.some((t) => t.id === tabOfBuilding(k)), k).toBe(true);
    }
    expect(tabOfBuilding('townhall')).toBe('resources');
    expect(tabOfBuilding('house')).toBe('housing');
  });
  it('порожні вкладки мають текст-заглушку', () => {
    for (const t of BUILD_TABS) if (!t.kinds.length) expect(t.soon.length).toBeGreaterThan(5);
  });
});
