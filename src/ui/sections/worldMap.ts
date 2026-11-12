import type { ActionSection } from '../windows';

/** «Світова карта»: вихід з міста на карту світу. */
export const mapSection: ActionSection = { id: 'map', icon: 'map', title: 'Карта', action: ({ hooks }) => hooks.back() };
