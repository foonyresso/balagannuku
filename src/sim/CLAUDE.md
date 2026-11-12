# sim: симуляція

Чиста детермінована функція `(стан, команди) -> стан`. Без DOM, Pixi, `Math.random` і `Date`. Імпортує лише `../shared`.

## Файли
Ядро:
- `world.ts`: `SimWorld` = `GameState` + робочі дані сектора (`SectorRt`: вузли, зайнятість, трафік) і NPC (`NpcRt`). `serialize` / `deserialize`, `createWorld`.
- `step.ts`: `stepWorld`, один тік. Плани NPC за професією (`plan*`), машина станів (`stepNpc`), логістика (`nearestAcceptor`, `nearestStorage`), згасання стежок, відростання, будинки. Великий: читай за назвою функції.
- `commands.ts`: `applyCommand`, `checkPlace`, `buildCheck`, `startCity`, `staffBuilding`.
- `balance.ts`: усі числа економіки (ціни, footprint, слоти, тривалості, їжа). Формат сейва від них не залежить.

Працівники:
- `assign.ts`: призначення й зняття з роботи, `autoStaffIdle`.
- `npcs.ts`: створення NPC.
- `residents.ts`: стан кожного жителя для UI.
- `flow.ts`: запис потоків ресурсів у `GameState.flows`.

Шлях:
- `route.ts`: `planRoute`, грубий A* по клітинках плюс спрощення за видимістю в тайлах.
- `path.ts`: A* і вартість клітинки за стадією стежки.
- `clear.ts`: прохідність за розміром NPC.

Генерація (усе виводиться з seed, у сейві не лежить):
- `worldgen.ts`: сектори світу, вибір старту.
- `nodegen.ts`: дерева й каміння в секторі.
- `water.ts`: озера.
- `noise.ts`, `rng.ts`, `hex.ts`, `pack.ts`: шум, ГПВЧ, гекс-координати, упаковка typed arrays.

## Правила
- Нову систему (звірі, вогнище тощо) клади в окремий файл і викликай зі `stepWorld`. У `step.ts` додавай лише виклик.
- Нове число балансу йде в `balance.ts`.
- Нова споруда чи професія: кроки в `docs/systems/economy.md`.
- Тест клади поруч із файлом (`foo.test.ts`), а не дописуй у `economy.test.ts`.
- Тести світу створюють карту 3312² тайлів, це секунди. Для дрібних перевірок бери `COMPACT_NODEGEN` і мінімум NPC.
