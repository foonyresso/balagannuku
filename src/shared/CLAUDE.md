# shared: контракти

Лише типи, чисті константи й чисті функції. Жодних залежностей від інших каталогів.

Паралельні гілки не правлять `shared/` без узгодження: це єдине місце, де зміна ламає всіх.

## Файли
- `ids.ts`: базові типи й ідентифікатори (`ResourceKind`, `BuildingKind`, `Profession`, `PackedArray`).
- `constants.ts`: розміри сітки й світу, частота тіків. Зміна впливає на формат сейва.
- `state.ts`: `GameState` (усе дерево стану), `BuildingState`, `NpcStore` (SoA, індекс = `NpcId`), `PROFESSIONS`, `TASKS`.
- `npc.ts`: стати (`NPC_STATS`), перки (`PERKS`), імена.
- `commands.ts`: `Command`, `CommandResult`. Єдиний спосіб змінити стан.
- `trails.ts`: стадії стежок, пороги, упаковка шару трафіку.
- `flows.ts`: облік потоків ресурсів (`FlowLedger`).
- `save.ts`: `SaveFile`, `SAVE_VERSION`, `MIGRATIONS`.
- `net.ts`: повідомлення клієнт-хост, `GameEvent`, `NET_PROTOCOL_VERSION`.

## Коли піднімати версії
- Змінилась форма `SerializedGameState` (поле, typed array, константа сітки): `SAVE_VERSION` + запис у `MIGRATIONS`. Подробиці в `docs/systems/save.md`.
- Змінилось `ClientMessage`, `HostMessage` або `GameEvent`: `NET_PROTOCOL_VERSION`.
- Нове необов'язкове поле (`foo?:`) версії не вимагає, якщо старий код його ігнорує.
- Новий елемент `PROFESSIONS`, `TASKS`, `NPC_STATS`, `PERKS` додавай лише в кінець: у сейві лежать індекси.
