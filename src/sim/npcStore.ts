import type { NpcStore } from '../shared';
import { EQUIPMENT_SLOTS, INVENTORY_SLOTS, MOOD_START, NPC_STAT_BASE, NPC_STAT_COUNT, PERK_SLOT_COUNT, perkSlotsFromMask } from '../shared';

/** Стати за замовчуванням (норма) для capacity NPC. */
export function defaultStats(capacity: number): Uint8Array {
  const a = new Uint8Array(capacity * NPC_STAT_COUNT);
  for (let i = 0; i < capacity; i++) for (let s = 0; s < NPC_STAT_COUNT; s++) a[i * NPC_STAT_COUNT + s] = NPC_STAT_BASE[s];
  return a;
}

export function createNpcStore(capacity: number): NpcStore {
  return {
    capacity, count: 0,
    alive: new Uint8Array(capacity), sector: new Uint16Array(capacity),
    x: new Float32Array(capacity), y: new Float32Array(capacity),
    profession: new Uint8Array(capacity), task: new Uint8Array(capacity),
    targetBuilding: new Int32Array(capacity).fill(-1), owner: new Uint8Array(capacity),
    hp: new Uint16Array(capacity), level: new Uint8Array(capacity),
    inventory: new Uint16Array(capacity * INVENTORY_SLOTS), equipment: new Uint16Array(capacity * EQUIPMENT_SLOTS),
    carryKind: new Uint8Array(capacity).fill(255), carryAmount: new Uint8Array(capacity),
    nameId: new Uint16Array(capacity), stats: defaultStats(capacity), perkSlots: new Uint16Array(capacity * PERK_SLOT_COUNT),
    fullness: new Uint8Array(capacity).fill(100),
    klass: new Uint8Array(capacity), xp: new Uint16Array(capacity), mana: new Uint16Array(capacity),
    gold: new Uint32Array(capacity), mood: new Uint8Array(capacity).fill(MOOD_START),
    buff: new Uint8Array(capacity), buffUntil: new Uint32Array(capacity), candidateUntil: new Uint32Array(capacity),
  };
}

/** Старе спорядження (4 слоти: голова, тіло, зброя, щит) -> нові 6 (зброя, друга рука, броня, взуття, шия, руки). Голова губиться. */
function upgradeEquipment(old: Uint16Array, capacity: number): Uint16Array {
  const fresh = new Uint16Array(capacity * EQUIPMENT_SLOTS);
  const oldN = old.length / capacity;
  if (oldN === 4) {
    for (let i = 0; i < capacity; i++) {
      fresh[i * EQUIPMENT_SLOTS] = old[i * 4 + 2]; // зброя
      fresh[i * EQUIPMENT_SLOTS + 1] = old[i * 4 + 3]; // щит -> друга рука
      fresh[i * EQUIPMENT_SLOTS + 2] = old[i * 4 + 1]; // тіло -> броня
    }
  }
  return fresh;
}

/**
 * Старі сейви: дописує масиви, яких ще не було, нормою, і переводить змінений формат (stride статів, перки, спорядження).
 * Мутує `npcs` (розпакований об'єкт з typed arrays). Викликає deserialize.
 */
export function fillNpcDefaults(npcs: Record<string, unknown>, capacity: number): void {
  const fresh = createNpcStore(capacity) as unknown as Record<string, unknown>;
  // Старий stride статів (до size, до бойових статів): переносимо наявні, решта норма.
  const stats = npcs.stats as Uint8Array | undefined;
  if (stats && stats.length !== capacity * NPC_STAT_COUNT) {
    const oldN = stats.length / capacity, next = defaultStats(capacity);
    for (let i = 0; i < capacity; i++) for (let s = 0; s < Math.min(oldN, NPC_STAT_COUNT); s++) next[i * NPC_STAT_COUNT + s] = stats[i * oldN + s];
    npcs.stats = next;
  }
  // Маска перків (до v10) -> слоти.
  if (!npcs.perkSlots && npcs.perks) {
    const mask = npcs.perks as Uint16Array, slots = new Uint16Array(capacity * PERK_SLOT_COUNT);
    for (let i = 0; i < capacity; i++) if (mask[i]) slots.set(perkSlotsFromMask(mask[i]), i * PERK_SLOT_COUNT);
    npcs.perkSlots = slots;
  }
  delete npcs.perks;
  const eq = npcs.equipment as Uint16Array | undefined;
  if (eq && eq.length !== capacity * EQUIPMENT_SLOTS) npcs.equipment = upgradeEquipment(eq, capacity);
  for (const [k, v] of Object.entries(fresh)) if (npcs[k] === undefined) npcs[k] = v;
}
