/** Прості лінійні іконки 24×24 (колір бере з currentColor). Нова іконка: рядок у `PATHS`. */
const PATHS = {
  build: '<path d="M14 4l6 6-3 3-6-6z"/><path d="M12 9L4 17l3 3 8-8"/>',
  economy: '<path d="M5 20V10M12 20V4M19 20v-7"/><path d="M3 20h18"/>',
  npcs: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6"/><circle cx="17" cy="9" r="2.4"/><path d="M16 14.2c3 .2 5 2.3 5 5.3"/>',
  inventory: '<path d="M6 8h12l1 12H5z"/><path d="M9 8V6a3 3 0 016 0v2"/>',
  map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
} as const;
export type IconName = keyof typeof PATHS;
export const icon = (n: IconName): string => `<svg class="k-ico" viewBox="0 0 24 24" aria-hidden="true">${PATHS[n]}</svg>`;
