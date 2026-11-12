import { PROFESSIONS, RESOURCE_KINDS, TASKS, statIndex } from '../../shared';

/** Фази NPC (робочий стан, у сейві не лежить: після завантаження NPC планує дію заново). Нову фазу додавай у кінець. */
export const PHASE = { PLAN: 0, WALK_NODE: 1, WORK_NODE: 2, WALK_DEPOSIT: 3, WALK_TAKE: 4, WALK_MILL: 5, WORK_MILL: 6, WAIT: 7, WALK_HOME: 8, WORK_HOME: 9, CARRY_PICK: 10, CARRY_DROP: 11, EAT: 12, FARM_WALK: 13, FARM_WORK: 14, IDLE_WALK: 15, IDLE_STAY: 16 } as const;

/** Індекс задачі (NpcStore.task) за назвою. */
export const taskId = (n: (typeof TASKS)[number]): number => TASKS.indexOf(n);

// Індекси ресурсів (NpcStore.carryKind), професій (NpcStore.profession) і статів.
export const WOOD = RESOURCE_KINDS.indexOf('wood'), STONE = RESOURCE_KINDS.indexOf('stone'), PLANKS = RESOURCE_KINDS.indexOf('planks'), FOOD = RESOURCE_KINDS.indexOf('food');
export const HUNTER = PROFESSIONS.indexOf('hunter'), FISHER = PROFESSIONS.indexOf('fisher'), FARMER = PROFESSIONS.indexOf('farmer');
export const CARRIER = PROFESSIONS.indexOf('carrier'), SAWYER = PROFESSIONS.indexOf('sawyer'), MINER = PROFESSIONS.indexOf('miner');
export const ST_WALK = statIndex('walk'), ST_CARRY = statIndex('carry'), ST_GATHER = statIndex('gather');
