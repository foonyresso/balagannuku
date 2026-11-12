import type { DockItem } from '../windows';
import { buildSection } from './build';
import { economySection } from './economy';
import { inventorySection } from './inventory';
import { mapSection } from './worldMap';
import { npcsSection } from './npcs';
import { settingsSection } from './settings';

/** Порядок розділів = порядок кнопок у нижній панелі. */
export const SECTIONS: DockItem[] = [buildSection, economySection, npcsSection, inventorySection, mapSection, settingsSection];
