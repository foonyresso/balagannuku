import type { Section } from '../windows';
import { buildSection } from './build';
import { economySection } from './economy';
import { npcsSection } from './npcs';

/** Порядок розділів = порядок кнопок у нижній панелі. */
export const SECTIONS: Section[] = [buildSection, economySection, npcsSection];
