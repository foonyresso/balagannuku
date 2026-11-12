# sim: симуляція

Чиста детермінована функція `(стан, команди) -> стан`. Без DOM, Pixi, `Math.random` і `Date`. Імпортує лише `../shared`.

## Куди йти
| Задача | Місце |
|---|---|
| поведінка працівника, нова професія | `jobs/` (свій `CLAUDE.md`) |
| щось відбувається зі світом саме по собі (стежки, ріст, населення) | `systems/` |
| числа: ціни, розміри, тривалості | `balance/` |
| команди гравця, правила розміщення | `commands.ts` |
| пошук шляху | `route.ts`, `path.ts`, `clear.ts` |
| генерація світу | `worldgen.ts`, `nodegen.ts`, `water.ts` |

## Файли
Ядро:
- `world.ts`: `SimWorld` = `GameState` + робочі дані сектора (`SectorRt`: вузли, зайнятість, трафік) і NPC (`NpcRt`). `serialize` / `deserialize`, `createWorld`.
- `step.ts`: `stepWorld`, один тік. Лише порядок викликів: жителі, голод, стежки, ріст, населення, потоки.
- `commands.ts`: `applyCommand`, `checkPlace`, `buildCheck`, `startCity`, `staffBuilding`.
- `stock.ts`: запаси споруд (`isStorage`, `stockOf`, `capOf`).
- `flow.ts`: запис потоків ресурсів у `GameState.flows`.

Системи світу (`systems/`), кожна викликається зі `stepWorld`:
- `systems/trails.ts`: трафік від ходіння (`stepOn`), згасання, прикріплення споруд до доріг, події зміни стадій.
- `systems/growth.ts`: відновлення зрубаних дерев і розбитого каміння.
- `systems/population.ts`: будинки поселяють жителів, `countPop`.
- `systems/resources.ts`: підсумок запасів гравця.
- `systems/camp.ts`: вогнище перед ратушею (`campfireOf`), слоти для вільних (`campTick`), заборона забудови на площі. Тест `systems/camp.test.ts`.

Баланс (`balance/`, імпорт як раніше: `from './balance'`):
- `balance/buildings.ts`: таблиця `BUILDINGS`, один запис на споруду (розмір, ціна, слоти, професія, місткість). `COSTS`, `FOOTPRINT`, `MAX_WORKERS`, `JOB_OF`, `STORAGE_CAP`, `SOLID_RECT`, `DEFAULT_WORKERS` виводяться з неї.
- `balance/work.ts`: тривалості дій, ноша, буфери, резерв дерева.
- `balance/people.ts`: швидкість і місткість NPC, населення, стартовий запас, їжа й голод.
- `balance/nature.ts`: вузли ресурсів, відростання.
- `balance/trails.ts`: тяга шляху до доріг, згасання стежок.

Працівники:
- `assign.ts`: призначення й зняття з роботи, `autoStaffIdle`.
- `npcs.ts`: створення NPC.
- `residents.ts`: стан кожного жителя для UI.

Шлях:
- `route.ts`: `planRoute`, грубий A* по клітинках плюс спрощення за видимістю в тайлах.
- `path.ts`: A* і вартість клітинки за стадією стежки.
- `clear.ts`: прохідність за розміром NPC.

Генерація (усе виводиться з seed, у сейві не лежить):
- `worldgen.ts`: сектори світу, вибір старту.
- `nodegen.ts`: дерева й каміння в секторі.
- `water.ts`: озера.
- `noise.ts`, `rng.ts`, `hex.ts`, `pack.ts`: шум, ГПВЧ, гекс-координати, упаковка typed arrays.

Тести:
- `testkit.ts`: спільні помічники (`setup`, `place`, `run`, `hall`). Світ тестів компактний (`COMPACT_NODEGEN`).
- Тест лежить поруч із тим, що перевіряє: `jobs/*.test.ts`, `systems/trails.test.ts`, `assign.test.ts`, `route.test.ts`. `economy.test.ts` — наскрізні: ланцюжок, команди, серіалізація, детермінізм.

## Правила
- Нова система світу (звірі, вогнище, день і ніч): файл у `systems/` і один рядок у `stepWorld`. Порядок у `stepWorld` впливає на детермінізм, без потреби не міняй.
- Нове число йде в `balance/`, нова споруда стає записом у `BUILDINGS`.
- Нова споруда чи професія: кроки в `docs/systems/economy.md`.
- Кожен тест створює карту 3312² тайлів, це секунди. Не плоди тести з однаковим сценарієм, перевіряй кілька речей в одному світі.
